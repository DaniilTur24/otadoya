import { prisma } from '@/lib/prisma';
import { USER_LINKED_TYPES } from '@/lib/employee-types';

/**
 * Зарплата нигде не хранится — она пересчитывается заново при каждом запросе из ТЕКУЩИХ
 * настроек (оклад, ставка, тип сотрудника, пороги премии аптеки, производственный календарь).
 * Поэтому правка любой из этих настроек молча меняет зарплату за ВСЕ прошлые месяцы, где у
 * сотрудника есть смены или отметки, — включая те, за которые уже выплачено.
 *
 * Этот модуль отвечает на вопрос «какие месяцы пересчитаются, если изменить эту настройку»,
 * чтобы интерфейс мог предупредить конкретикой, а не общей фразой. Тот же принцип, что уже
 * применён в findPharmacyUnlinkBlocker (см. employee-pharmacy-validation.ts): сначала считаем
 * существующие записи, потом решаем, насколько опасно действие.
 */

export interface ImpactMonth {
  year: number;
  month: number;
  /** Смен в записях выручки (для аптеки — подтверждённых записей выручки) */
  shifts: number;
  /** Отметок в табеле посещаемости */
  attendance: number;
  /** Месяц закрыт — его цифры уже зафиксированы, пересчёт его не тронет */
  isClosed: boolean;
}

export interface SalaryImpact {
  months: ImpactMonth[];
  /** Суммарно записей по всем месяцам — быстрый признак «есть ли вообще что ломать» */
  totalRecords: number;
}

export interface PharmacySalaryImpact extends SalaryImpact {
  /** Заведующие/менеджеры аптеки с включённой лестничной премией — их затронут пороги премии */
  ladderEmployees: { id: number; name: string; employeeType: string }[];
  /** Сотрудники со сменной оплатой в аптеке — их затронет переключатель средней выручки */
  shiftEmployees: { id: number; name: string; employeeType: string }[];
}

type MonthAccumulator = Map<string, { year: number; month: number; shifts: number; attendance: number }>;

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

function addToMonth(acc: MonthAccumulator, date: Date, field: 'shifts' | 'attendance') {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const key = monthKey(year, month);
  let entry = acc.get(key);
  if (!entry) {
    entry = { year, month, shifts: 0, attendance: 0 };
    acc.set(key, entry);
  }
  entry[field]++;
}

/** Помечает месяцы как закрытые и сортирует от свежих к старым. */
async function finalize(acc: MonthAccumulator): Promise<SalaryImpact> {
  const closed = await prisma.closedMonth.findMany({ select: { year: true, month: true } });
  const closedKeys = new Set(closed.map((c) => monthKey(c.year, c.month)));

  const months: ImpactMonth[] = [...acc.values()]
    .map((m) => ({ ...m, isClosed: closedKeys.has(monthKey(m.year, m.month)) }))
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));

  return { months, totalRecords: months.reduce((sum, m) => sum + m.shifts + m.attendance, 0) };
}

/**
 * Месяцы, которые пересчитаются при изменении настроек конкретного сотрудника
 * (оклад, ставка за смену, фиксированная доплата, тип сотрудника, источник смен).
 *
 * Для заведующих/менеджеров (USER_LINKED_TYPES) дополнительно учитываются месяцы, где у их
 * аптек была выручка: лестничная премия и доля 10% от бонусов начисляются им независимо от
 * личных смен, поэтому переключение этих премий затрагивает и месяцы без личных отметок.
 */
export async function getEmployeeSalaryImpact(employeeId: number): Promise<SalaryImpact | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeType: true, pharmacies: { select: { pharmacyId: true } } },
  });
  if (!employee) return null;

  const [revenueEntries, attendanceShifts] = await Promise.all([
    prisma.dailyRevenueEntry.findMany({
      where: { employeeId, status: 'approved', shiftType: { not: null } },
      select: { date: true },
    }),
    prisma.attendanceShift.findMany({ where: { employeeId }, select: { date: true } }),
  ]);

  const acc: MonthAccumulator = new Map();
  for (const e of revenueEntries) addToMonth(acc, e.date, 'shifts');
  for (const s of attendanceShifts) addToMonth(acc, s.date, 'attendance');

  // Премии заведующей/менеджера считаются от выручки её аптек, а не от личных смен — месяц
  // без единой её отметки всё равно пересчитается при смене оклада/переключателей премии.
  if (USER_LINKED_TYPES.has(employee.employeeType)) {
    const pharmacyIds = employee.pharmacies.map((p) => p.pharmacyId);
    if (pharmacyIds.length > 0) {
      const pharmacyRevenue = await prisma.dailyRevenueEntry.findMany({
        where: { pharmacyId: { in: pharmacyIds }, status: 'approved' },
        select: { date: true },
      });
      for (const e of pharmacyRevenue) {
        const key = monthKey(e.date.getFullYear(), e.date.getMonth() + 1);
        if (!acc.has(key)) {
          acc.set(key, { year: e.date.getFullYear(), month: e.date.getMonth() + 1, shifts: 0, attendance: 0 });
        }
      }
    }
  }

  return finalize(acc);
}

/**
 * Месяцы и сотрудники, которых затронет изменение настроек премии аптеки
 * (пороги лестничной премии, переключатель средней выручки по аптеке).
 */
export async function getPharmacySalaryImpact(pharmacyId: number): Promise<PharmacySalaryImpact | null> {
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId }, select: { id: true } });
  if (!pharmacy) return null;

  const [revenueEntries, attendanceShifts, linked] = await Promise.all([
    prisma.dailyRevenueEntry.findMany({
      where: { pharmacyId, status: 'approved' },
      select: { date: true },
    }),
    prisma.attendanceShift.findMany({ where: { pharmacyId }, select: { date: true } }),
    prisma.employeePharmacy.findMany({
      where: { pharmacyId, employee: { isActive: true } },
      select: {
        employee: {
          select: { id: true, name: true, employeeType: true, ladderPremiumEnabled: true },
        },
      },
    }),
  ]);

  const acc: MonthAccumulator = new Map();
  for (const e of revenueEntries) addToMonth(acc, e.date, 'shifts');
  for (const s of attendanceShifts) addToMonth(acc, s.date, 'attendance');

  const employees = linked.map((l) => l.employee);

  return {
    ...(await finalize(acc)),
    ladderEmployees: employees
      .filter((e) => e.ladderPremiumEnabled)
      .map(({ id, name, employeeType }) => ({ id, name, employeeType })),
    // Средняя выручка по аптеке заменяет личную премию за смену — касается тех, у кого смены
    // привязаны к записям выручки (seller / manager_trading).
    shiftEmployees: employees
      .filter((e) => e.employeeType === 'seller' || e.employeeType === 'manager_trading')
      .map(({ id, name, employeeType }) => ({ id, name, employeeType })),
  };
}
