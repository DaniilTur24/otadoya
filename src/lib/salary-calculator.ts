import { prisma } from '@/lib/prisma';
export { SHIFT_TYPE_LABELS } from '@/lib/shift-types';

export interface MonthlySalaryResult {
  employeeId: number;
  employeeName: string;
  month: number;
  year: number;
  baseSalary: number;
  dayShiftsCount: number;
  fullDayShiftsCount: number;
  salaryFromDayShifts: number;
  salaryFromFullDayShifts: number;
  totalBonuses: number;
  totalAdvances: number;
  totalSalary: number;
  revenueTotal: number;
  recordsCount: number;
}

export interface ShiftEntry {
  id: number;
  date: Date;
  pharmacyId: number;
  pharmacyName: string;
  shiftType: string | null;
  /** Сумма бонусов из строк расходов с категорией 'pharmaBonus' за эту запись */
  bonusRevenue: number;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
}

/**
 * Рассчитывает зарплату сотрудника за указанный месяц.
 *
 * Формула:
 *   salaryFromFullDayShifts = baseSalary / 10 * fullDayShiftsCount
 *   salaryFromDayShifts     = baseSalary / 15 * dayShiftsCount
 *   totalSalary             = salaryFromFullDayShifts + salaryFromDayShifts + totalBonuses - totalAdvances
 *
 * Авансы (категория 'employeeAdvance') вычитаются из накопленной зарплаты;
 * если авансов больше заработанного — итоговая зарплата уходит в минус.
 *
 * Учитывает только записи со статусом 'approved'.
 * Если передан pharmacyId — фильтрует по аптеке.
 */
export async function calculateEmployeeMonthlySalary(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<MonthlySalaryResult | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  const dateFrom = new Date(year, month - 1, 1);
  const dateTo = new Date(year, month, 0, 23, 59, 59, 999);

  const entryFilter = {
    employeeId,
    status: 'approved',
    date: { gte: dateFrom, lte: dateTo },
    ...(pharmacyId ? { pharmacyId } : {}),
  };

  // Авансы привязаны напрямую к сотруднику-получателю (DailyExpenseItem.employeeId),
  // а не к employeeId записи выручки — выдать аванс может за смену другого сотрудника.
  const advanceEntryFilter = {
    status: 'approved',
    date: { gte: dateFrom, lte: dateTo },
    ...(pharmacyId ? { pharmacyId } : {}),
  };

  const [entries, pharmaBonusAgg, advanceAgg] = await Promise.all([
    prisma.dailyRevenueEntry.findMany({
      where: entryFilter,
      select: {
        shiftType: true,
        cashRevenue: true,
        terminalRevenue: true,
        kaspiRevenue: true,
      },
    }),
    // Бонусы берутся из строк расходов с категорией 'pharmaBonus',
    // введённых в записях выручки этого сотрудника за данный период.
    prisma.dailyExpenseItem.aggregate({
      _sum: { amount: true },
      where: { category: 'pharmaBonus', entry: entryFilter },
    }),
    // Авансы берутся из строк расходов с категорией 'employeeAdvance',
    // привязанных к этому сотруднику как получателю (может отличаться от сотрудника записи).
    prisma.dailyExpenseItem.aggregate({
      _sum: { amount: true },
      where: { category: 'employeeAdvance', employeeId, entry: advanceEntryFilter },
    }),
  ]);

  const baseSalary = Number(employee.baseSalary);
  let dayShiftsCount = 0;
  let fullDayShiftsCount = 0;
  const totalBonuses = Number(pharmaBonusAgg._sum.amount ?? 0);
  const totalAdvances = Number(advanceAgg._sum.amount ?? 0);
  let revenueTotal = 0;

  for (const e of entries) {
    if (e.shiftType === 'day') dayShiftsCount++;
    else if (e.shiftType === 'full_day') fullDayShiftsCount++;
    revenueTotal +=
      Number(e.cashRevenue) + Number(e.terminalRevenue) + Number(e.kaspiRevenue ?? 0);
  }

  const salaryFromFullDayShifts = baseSalary > 0 ? (baseSalary / 10) * fullDayShiftsCount : 0;
  const salaryFromDayShifts = baseSalary > 0 ? (baseSalary / 15) * dayShiftsCount : 0;
  const totalSalary = salaryFromFullDayShifts + salaryFromDayShifts + totalBonuses - totalAdvances;

  return {
    employeeId,
    employeeName: employee.name,
    month,
    year,
    baseSalary,
    dayShiftsCount,
    fullDayShiftsCount,
    salaryFromDayShifts,
    salaryFromFullDayShifts,
    totalBonuses,
    totalAdvances,
    totalSalary,
    revenueTotal,
    recordsCount: entries.length,
  };
}

/**
 * Возвращает список смен сотрудника за месяц с деталями по каждой записи.
 */
export async function getEmployeeMonthlyShifts(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<ShiftEntry[]> {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo = new Date(year, month, 0, 23, 59, 59, 999);

  const where: Record<string, unknown> = {
    employeeId,
    status: 'approved',
    date: { gte: dateFrom, lte: dateTo },
  };
  if (pharmacyId) where.pharmacyId = pharmacyId;

  const entries = await prisma.dailyRevenueEntry.findMany({
    where,
    include: {
      pharmacy: { select: { name: true } },
      expenseItems: { where: { category: 'pharmaBonus' }, select: { amount: true } },
    },
    orderBy: { date: 'asc' },
  });

  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    pharmacyId: e.pharmacyId,
    pharmacyName: e.pharmacy.name,
    shiftType: e.shiftType,
    bonusRevenue: e.expenseItems.reduce((sum, i) => sum + Number(i.amount), 0),
    cashRevenue: Number(e.cashRevenue),
    terminalRevenue: Number(e.terminalRevenue),
    kaspiRevenue: Number((e as unknown as Record<string, unknown>).kaspiRevenue ?? 0),
  }));
}

export interface AdvanceEntry {
  id: number;
  date: Date;
  pharmacyName: string;
  amount: number;
  comment: string | null;
}

/**
 * Возвращает список авансов, выданных сотруднику за месяц.
 * Аванс привязан к сотруднику напрямую (DailyExpenseItem.employeeId) — он может
 * быть записан в записи выручки другого сотрудника (например, по смене коллеги).
 */
export async function getEmployeeMonthlyAdvances(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<AdvanceEntry[]> {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo = new Date(year, month, 0, 23, 59, 59, 999);

  const items = await prisma.dailyExpenseItem.findMany({
    where: {
      category: 'employeeAdvance',
      employeeId,
      entry: {
        status: 'approved',
        date: { gte: dateFrom, lte: dateTo },
        ...(pharmacyId ? { pharmacyId } : {}),
      },
    },
    include: { entry: { select: { date: true, pharmacy: { select: { name: true } } } } },
    orderBy: { entry: { date: 'asc' } },
  });

  return items.map((i) => ({
    id: i.id,
    date: i.entry.date,
    pharmacyName: i.entry.pharmacy.name,
    amount: Number(i.amount),
    comment: i.comment,
  }));
}

/**
 * Рассчитывает зарплаты всех активных сотрудников за месяц.
 * Удобно для интеграции в закрытие месяца.
 */
export async function calculateAllEmployeesSalaries(
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<MonthlySalaryResult[]> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  const results: MonthlySalaryResult[] = [];
  for (const emp of employees) {
    const result = await calculateEmployeeMonthlySalary(emp.id, month, year, pharmacyId);
    if (result && result.recordsCount > 0) {
      results.push(result);
    }
  }
  return results;
}
