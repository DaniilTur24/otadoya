import { prisma } from '@/lib/prisma';
import { calculateEmployeeMonthlySalary, type MonthlySalaryResult } from '@/lib/salary-calculator';
import { roundMoney } from '@/lib/money';
import { MANAGER_TYPES } from '@/lib/employee-types';

export interface RevenueDeleteEmployeeImpact {
  employeeId: number;
  employeeName: string;
  before: number;
  after: number;
}

export interface RevenueDeleteImpact {
  revenue: { pharmacyName: string; before: number; after: number } | null;
  employees: RevenueDeleteEmployeeImpact[];
  /** true — оценка неполная: у владельца смены могла бы измениться и премия/лестница/доля
   * бонуса (они зависят от порогов выручки, см. computeManagerLadderPremium/revenuePremium),
   * но пересчитывать их без реального удаления небезопасно (см. комментарий ниже) — здесь
   * учтена только линейная, гарантированно точная часть: сменная оплата и бонус самой записи.
   * Бонус записи к тому же уменьшает долю заведующих аптеки: они в оценку не входят. */
  partial: boolean;
}

const PROTECTED_CATEGORIES = ['employeeAdvance', 'employeeSurcharge'] as const;

/**
 * Итог к выплате до округления. «После» считается от него и округляется один раз в конце:
 * от уже округлённого totalSalary результат мог бы разойтись с настоящим итогом на 5 ₸.
 */
function exactSalary(salary: MonthlySalaryResult): number {
  return salary.grossAccrued + salary.totalBonuses - salary.totalAdvances;
}

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1);
}
function endOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

/**
 * Оценка (не 100%-но точная — см. `partial`) того, как изменятся выручка аптеки и зарплата
 * затронутых сотрудников, если эту запись удалить, БЕЗ реального удаления и без записи чего-либо
 * в базу — только чтение. Показывается перед удалением, чтобы бухгалтер видел не абстрактное
 * "данные пересчитаются", а конкретные суммы.
 *
 * Почему не пересчитано через реальный calculateEmployeeMonthlySalary "как если бы записи не
 * было": единственный точный способ так посчитать — временно выставить excludedFromReport=true,
 * вызвать функцию и вернуть обратно. Это реальная запись в базу (пусть и на доли секунды с
 * гарантированным восстановлением) ради превью — то есть ровно тот же класс риска, который эта
 * сессия QA стремится убрать, а не добавить. Поэтому здесь считается без единой записи: выручка
 * аптеки и аванс/доплата — это чистая сумма без порогов, поэтому разница считается напрямую и
 * гарантированно точна. А вот премия за выручку/лестничная премия/доля бонуса зависят от порогов
 * (см. computeLadderPremium, revenuePremium в salary-calculator.ts) — удаление одной записи может
 * нелинейно уронить их (например, ниже порога лестницы), и без реального пересчёта это не
 * предсказать надёжно. Отражена только гарантированно точная часть — сменная оплата
 * (baseSalary/15 или /10 × количество смен, без округления "по кусочкам" — пересчитывается
 * весь округлённый итог с count-1, а не вычитается округлённая доля одной смены) и бонус записи.
 */
export async function computeRevenueDeleteImpact(entryId: number): Promise<RevenueDeleteImpact | null> {
  const entry = await prisma.dailyRevenueEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.status !== 'approved' || entry.excludedFromReport) return null;

  const month = entry.date.getMonth() + 1;
  const year = entry.date.getFullYear();

  const items = await prisma.dailyExpenseItem.findMany({
    where: { entryId, category: { in: [...PROTECTED_CATEGORIES, 'pharmaBonus'] } },
    include: { employee: { select: { name: true } } },
  });
  const protectedItems = items.filter((item) => item.category !== 'pharmaBonus');
  const entryBonus = items
    .filter((item) => item.category === 'pharmaBonus')
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const employees: RevenueDeleteEmployeeImpact[] = [];
  // Доля заведующей — 10% от всех бонусов её аптек, поэтому от бонуса записи она тоже зависит
  let partial = entryBonus > 0 && (await prisma.employee.count({
    where: {
      employeeType: { in: [...MANAGER_TYPES] },
      managerBonusShareEnabled: true,
      pharmacies: { some: { pharmacyId: entry.pharmacyId } },
    },
  })) > 0;

  if (entry.employeeId) {
    const owner = await prisma.employee.findUnique({ where: { id: entry.employeeId }, select: { name: true } });
    const before = await calculateEmployeeMonthlySalary(entry.employeeId, month, year);
    if (owner && before) {
      let after = exactSalary(before);
      if (entry.shiftType === 'day' && before.dayShiftsCount > 0) {
        const afterShiftPay = roundMoney(before.baseSalary > 0 ? (before.baseSalary / 15) * (before.dayShiftsCount - 1) : 0);
        after -= before.salaryFromDayShifts - afterShiftPay;
        partial = true;
      } else if (entry.shiftType === 'full_day' && before.fullDayShiftsCount > 0) {
        const afterShiftPay = roundMoney(before.baseSalary > 0 ? (before.baseSalary / 10) * (before.fullDayShiftsCount - 1) : 0);
        after -= before.salaryFromFullDayShifts - afterShiftPay;
        partial = true;
      }
      // Личные бонусы входят в зарплату не у всех типов: у табельных totalBonuses всегда 0.
      after -= Math.min(entryBonus, before.totalBonuses);
      employees.push({ employeeId: entry.employeeId, employeeName: owner.name, before: before.totalSalary, after });
    }
  }

  for (const item of protectedItems) {
    if (!item.employeeId) continue;
    const amount = Number(item.amount);
    // Аванс вычитается из зарплаты получателя (уже выданные деньги) — без него после удаления
    // сумма к выплате вырастет. Доплата, наоборот, прибавляется — без неё сумма уменьшится.
    const delta = item.category === 'employeeAdvance' ? amount : -amount;
    const existing = employees.find((e) => e.employeeId === item.employeeId);
    if (existing) {
      existing.after += delta;
    } else {
      const before = await calculateEmployeeMonthlySalary(item.employeeId, month, year);
      if (before) {
        employees.push({
          employeeId: item.employeeId,
          employeeName: item.employee?.name ?? '—',
          before: before.totalSalary,
          after: exactSalary(before) + delta,
        });
      }
    }
  }

  for (const employee of employees) {
    employee.after = roundMoney(employee.after);
  }

  const revenueAgg = await prisma.dailyRevenueEntry.aggregate({
    _sum: { cashRevenue: true, terminalRevenue: true, kaspiRevenue: true },
    where: {
      pharmacyId: entry.pharmacyId,
      status: 'approved',
      excludedFromReport: false,
      date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
    },
  });
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: entry.pharmacyId }, select: { name: true } });
  const beforeRevenue =
    Number(revenueAgg._sum.cashRevenue ?? 0) + Number(revenueAgg._sum.terminalRevenue ?? 0) + Number(revenueAgg._sum.kaspiRevenue ?? 0);
  const thisEntryRevenue = Number(entry.cashRevenue) + Number(entry.terminalRevenue) + Number(entry.kaspiRevenue);

  return {
    revenue: pharmacy ? { pharmacyName: pharmacy.name, before: beforeRevenue, after: beforeRevenue - thisEntryRevenue } : null,
    employees,
    partial,
  };
}
