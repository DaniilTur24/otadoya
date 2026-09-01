import { prisma } from '@/lib/prisma';
export { SHIFT_TYPE_LABELS } from '@/lib/shift-types';
export { EMPLOYEE_TYPE_LABELS } from '@/lib/employee-types';
import {
  MANAGER_BONUS_SHARE_PERCENT,
  MANAGER_TYPES,
  USER_LINKED_TYPES,
  resolveWorkSchedule,
  usesAttendance,
  usesRevenueShifts,
  type WorkSchedule,
} from '@/lib/employee-types';

export interface MonthlySalaryResult {
  employeeId: number;
  employeeName: string;
  employeeType: string;
  month: number;
  year: number;
  baseSalary: number;
  /** График работы, по которому шёл расчёт (выведенный, если явно не выбран) */
  workSchedule: WorkSchedule;
  /** Оклад, применённый к пятидневным дням — равен baseSalary, если второй оклад не задан */
  fiveDaySalary: number;
  dayShiftsCount: number;
  fullDayShiftsCount: number;
  fiveDayShiftsCount: number;
  salaryFromDayShifts: number;
  salaryFromFullDayShifts: number;
  salaryFromFiveDayShifts: number;
  /** null — если производственный календарь не заполнен для этого месяца */
  workingCalendarDays: number | null;
  revenuePremiumDayShifts: number;
  revenuePremiumFullDayShifts: number;
  totalRevenuePremium: number;
  totalBonuses: number;
  totalAdvances: number;
  /** Доплаты сотруднику (category='employeeSurcharge') — прибавляются к зарплате, отдельно от pharmaBonus */
  totalSurcharges: number;
  /** Кол-во отметок в табеле посещаемости (manager_fixed / cleaner / office) */
  attendanceShiftsCount: number;
  /** Ставка за смену — только для cleaner */
  shiftRate: number | null;
  /** shiftRate × attendanceShiftsCount — только для cleaner */
  salaryFromShiftRate: number;
  /** 10% от бонусов аптек, которыми управляет заведующая/менеджер (если managerBonusShareEnabled) */
  managerBonusShare: number;
  /** Сумма бонусов управляемых аптек, от которой считается managerBonusShare (до применения 10%) */
  managedBonusTotal: number;
  /** Фиксированная ежемесячная доплата сотруднику */
  allowance: number;
  /** Описание, за что начислена доплата */
  allowanceDescription: string;
  /** Лестничная премия по выручке аптеки/аптек (заведующие/менеджер) или всех аптек (office) */
  managerLadderPremium: number;
  /** Выручка, от которой считалась лестничная премия */
  managedRevenueTotal: number;
  /** Включена ли лестничная премия — для manager_trading/manager_fixed/pharmacy_manager */
  ladderPremiumEnabled: boolean;
  /** Включена ли доля 10% от бонусов аптеки — для manager_trading/manager_fixed/pharmacy_manager */
  managerBonusShareEnabled: boolean;
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

export interface AttendanceEntry {
  id: number;
  date: Date;
  pharmacyId: number | null;
  pharmacyName: string | null;
  overtimeHours: number;
}

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1);
}

function endOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

/**
 * Премия "по лестнице": при revenue >= threshold выдаётся base, далее за каждые
 * полных stepAmount сверх порога добавляется stepBonus. Используется и для
 * заведующих (на уровне аптеки), и для офиса (на уровне суммарной выручки всех аптек).
 */
function computeLadderPremium(
  revenue: number,
  threshold: number | null,
  base: number | null,
  stepAmount: number | null,
  stepBonus: number | null,
): number {
  if (threshold === null || base === null || revenue < threshold) return 0;
  let premium = base;
  if (stepAmount && stepAmount > 0 && stepBonus) {
    const steps = Math.floor((revenue - threshold) / stepAmount);
    premium += steps * stepBonus;
  }
  return premium;
}

function resolveManagedPharmacyIds(
  employee: { pharmacies: { pharmacyId: number }[] },
  pharmacyId?: number,
): number[] {
  const managed = employee.pharmacies.map((p) => p.pharmacyId);
  if (pharmacyId) return managed.includes(pharmacyId) ? [pharmacyId] : [];
  return managed;
}

/**
 * Считает лестничную премию и выручку по аптекам, которыми управляет заведующая.
 * Каждая аптека использует свои собственные пороги/шаг (Pharmacy.managerPremium*).
 */
async function computeManagerLadderPremium(
  pharmacyIds: number[],
  month: number,
  year: number,
): Promise<{ premium: number; revenueTotal: number }> {
  if (pharmacyIds.length === 0) return { premium: 0, revenueTotal: 0 };

  const dateFrom = startOfMonth(year, month);
  const dateTo = endOfMonth(year, month);

  const [pharmacies, revenueRows] = await Promise.all([
    prisma.pharmacy.findMany({
      where: { id: { in: pharmacyIds } },
      select: {
        id: true,
        managerPremiumThreshold: true,
        managerPremiumBase: true,
        managerPremiumStepAmount: true,
        managerPremiumStepBonus: true,
      },
    }),
    prisma.dailyRevenueEntry.findMany({
      where: {
        pharmacyId: { in: pharmacyIds },
        status: 'approved',
        excludedFromReport: false,
        date: { gte: dateFrom, lte: dateTo },
      },
      select: { pharmacyId: true, cashRevenue: true, terminalRevenue: true, kaspiRevenue: true },
    }),
  ]);

  const revenueByPharmacy = new Map<number, number>();
  for (const r of revenueRows) {
    const sum = Number(r.cashRevenue) + Number(r.terminalRevenue) + Number(r.kaspiRevenue ?? 0);
    revenueByPharmacy.set(r.pharmacyId, (revenueByPharmacy.get(r.pharmacyId) ?? 0) + sum);
  }

  let premium = 0;
  let revenueTotal = 0;
  for (const ph of pharmacies) {
    const revenue = revenueByPharmacy.get(ph.id) ?? 0;
    revenueTotal += revenue;
    premium += computeLadderPremium(
      revenue,
      ph.managerPremiumThreshold !== null ? Number(ph.managerPremiumThreshold) : null,
      ph.managerPremiumBase !== null ? Number(ph.managerPremiumBase) : null,
      ph.managerPremiumStepAmount !== null ? Number(ph.managerPremiumStepAmount) : null,
      ph.managerPremiumStepBonus !== null ? Number(ph.managerPremiumStepBonus) : null,
    );
  }
  return { premium, revenueTotal };
}

/**
 * Средняя выручка аптеки за смену каждого типа (день/сутки) за месяц — сумма выручки всех
 * подтверждённых смен этого типа (по всем сотрудникам), делённая на их количество.
 * Используется вместо личной выручки сотрудника, когда у аптеки включён
 * Pharmacy.poolAverageRevenuePremium.
 */
async function computePooledShiftAverages(
  pharmacyId: number,
  month: number,
  year: number,
): Promise<{ avgDayRevenue: number; avgFullDayRevenue: number }> {
  const entries = await prisma.dailyRevenueEntry.findMany({
    where: {
      pharmacyId,
      status: 'approved',
      date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
    },
    select: { shiftType: true, cashRevenue: true, terminalRevenue: true },
  });

  let dayRevenue = 0;
  let dayCount = 0;
  let fullDayRevenue = 0;
  let fullDayCount = 0;
  for (const e of entries) {
    // Личная премия продавца (и её пул-среднее) считается без kaspi — только cash + terminal.
    const revenue = Number(e.cashRevenue) + Number(e.terminalRevenue);
    if (e.shiftType === 'day') {
      dayRevenue += revenue;
      dayCount++;
    } else if (e.shiftType === 'full_day') {
      fullDayRevenue += revenue;
      fullDayCount++;
    }
  }

  return {
    avgDayRevenue: dayCount > 0 ? dayRevenue / dayCount : 0,
    avgFullDayRevenue: fullDayCount > 0 ? fullDayRevenue / fullDayCount : 0,
  };
}

/** Округление до ближайших 5 тенге — так исторически считали долю заведующей вручную. */
function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

/** 10% от суммы всех pharmaBonus, заработанных в управляемых аптеках за месяц (включая свои). */
async function computeManagerBonusShare(
  pharmacyIds: number[],
  month: number,
  year: number,
): Promise<{ share: number; total: number }> {
  if (pharmacyIds.length === 0) return { share: 0, total: 0 };
  const dateFrom = startOfMonth(year, month);
  const dateTo = endOfMonth(year, month);

  const agg = await prisma.dailyExpenseItem.aggregate({
    _sum: { amount: true },
    where: {
      category: 'pharmaBonus',
      entry: {
        pharmacyId: { in: pharmacyIds },
        status: 'approved',
        date: { gte: dateFrom, lte: dateTo },
      },
    },
  });
  const total = Number(agg._sum.amount ?? 0);
  return { share: roundToNearest5(total * MANAGER_BONUS_SHARE_PERCENT), total };
}

/**
 * Находит премию по таблице произвольных диапазонов выручки (OfficePremiumTier).
 * Диапазон: fromAmount < revenue <= toAmount; toAmount = null — без верхней границы.
 * Диапазоны не накопительные — премия берётся из той единственной строки, в которую
 * попадает выручка, а не суммируется по предыдущим строкам.
 */
function findOfficeTierBonus(
  revenue: number,
  tiers: { fromAmount: unknown; toAmount: unknown; bonusAmount: unknown }[],
): number {
  for (const t of tiers) {
    const from = Number(t.fromAmount);
    const to = t.toAmount !== null ? Number(t.toAmount) : null;
    if (revenue > from && (to === null || revenue <= to)) {
      return Number(t.bonusAmount);
    }
  }
  return 0;
}

/** Премия офиса: таблица диапазонов выручки (OfficePremiumTier) от суммарной выручки всех аптек. */
async function computeOfficeLadderPremium(
  month: number,
  year: number,
): Promise<{ premium: number; revenueTotal: number }> {
  const dateFrom = startOfMonth(year, month);
  const dateTo = endOfMonth(year, month);

  const [tiers, agg] = await Promise.all([
    prisma.officePremiumTier.findMany({ orderBy: { fromAmount: 'asc' } }),
    prisma.dailyRevenueEntry.aggregate({
      _sum: { cashRevenue: true, terminalRevenue: true, kaspiRevenue: true },
      where: { status: 'approved', excludedFromReport: false, date: { gte: dateFrom, lte: dateTo } },
    }),
  ]);

  const revenueTotal =
    Number(agg._sum.cashRevenue ?? 0) +
    Number(agg._sum.terminalRevenue ?? 0) +
    Number(agg._sum.kaspiRevenue ?? 0);

  return { premium: findOfficeTierBonus(revenueTotal, tiers), revenueTotal };
}

async function getAttendanceShiftsCount(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<number> {
  return prisma.attendanceShift.count({
    where: {
      employeeId,
      date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
      ...(pharmacyId ? { pharmacyId } : {}),
    },
  });
}

/** Авансы выданные сотруднику как получателю — общий механизм для всех типов сотрудников. */
async function computeAdvances(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<number> {
  const agg = await prisma.dailyExpenseItem.aggregate({
    _sum: { amount: true },
    where: {
      category: 'employeeAdvance',
      employeeId,
      entry: {
        status: 'approved',
        date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
        ...(pharmacyId ? { pharmacyId } : {}),
      },
    },
  });
  return Number(agg._sum.amount ?? 0);
}

/**
 * Доплата, выданная сотруднику как получателю (category='employeeSurcharge') — тот же механизм,
 * что и аванс, но прибавляется к зарплате, а не вычитается, и ведётся отдельно от pharmaBonus
 * (та — общий котёл аптеки для доли заведующей, доплата — персональная, в статистику бонусов не входит).
 */
async function computeSurcharges(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<number> {
  const agg = await prisma.dailyExpenseItem.aggregate({
    _sum: { amount: true },
    where: {
      category: 'employeeSurcharge',
      employeeId,
      entry: {
        status: 'approved',
        date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
        ...(pharmacyId ? { pharmacyId } : {}),
      },
    },
  });
  return Number(agg._sum.amount ?? 0);
}

const EMPTY_RESULT_BASE = {
  // Умолчание подходит для cleaner/office — оба отмечаются только в табеле. Расчёт по
  // графику (calculateScheduleBasedSalary) перекрывает оба поля своими значениями.
  workSchedule: 'five_day' as WorkSchedule,
  fiveDaySalary: 0,
  dayShiftsCount: 0,
  fullDayShiftsCount: 0,
  fiveDayShiftsCount: 0,
  salaryFromDayShifts: 0,
  salaryFromFullDayShifts: 0,
  salaryFromFiveDayShifts: 0,
  workingCalendarDays: null as number | null,
  revenuePremiumDayShifts: 0,
  revenuePremiumFullDayShifts: 0,
  totalRevenuePremium: 0,
  totalBonuses: 0,
  attendanceShiftsCount: 0,
  shiftRate: null as number | null,
  salaryFromShiftRate: 0,
  managerBonusShare: 0,
  managedBonusTotal: 0,
  allowance: 0,
  allowanceDescription: '',
  managerLadderPremium: 0,
  managedRevenueTotal: 0,
  ladderPremiumEnabled: false,
  managerBonusShareEnabled: false,
  revenueTotal: 0,
  recordsCount: 0,
};

/**
 * Единый расчёт для всех, чья зарплата складывается из отработанных дней: продавца (seller) и
 * всех трёх «управленческих» типов (manager_trading / manager_fixed / pharmacy_manager).
 *
 * Раньше это были три почти дословно одинаковые функции, и различал их только источник
 * отработанных дней. Но источник — свойство графика человека, а не его должности: один и тот же
 * человек может в одни дни выходить на суточную/дневную смену, а в другие — по пятидневке.
 * Поэтому источник берётся из Employee.workSchedule (см. resolveWorkSchedule):
 *
 *   shift    — только смены в записях выручки:
 *              salaryFromFullDayShifts = baseSalary / 10 * fullDayShiftsCount
 *              salaryFromDayShifts     = baseSalary / 15 * dayShiftsCount
 *   five_day — только отметки табеля:
 *              salaryFromFiveDayShifts = fiveDayBase / workingDays * attendanceShiftsCount
 *   mixed    — обе части сразу, каждая по своей формуле и по своему окладу.
 *
 * Оклад за пятидневку (fiveDayBase) берётся из Employee.fiveDaySalary; если он не задан —
 * из baseSalary, то есть как считалось до появления второго оклада.
 *
 * Премия по выручке (revenuePremium: 200k/300k порог, 1.5% от избытка за смену, floor в 0 на
 * каждый тип смены независимо — недобор не вычитается из оклада) считается по умолчанию от личной
 * выручки сотрудника за его смены. Если у аптеки включено Pharmacy.poolAverageRevenuePremium —
 * вместо личной выручки берётся средняя выручка аптеки за смену того же типа за месяц
 * (см. computePooledShiftAverages). Если у заведующей включена лестничная премия аптеки
 * (ladderPremiumEnabled) — эта премия не начисляется вовсе, вместо неё managerLadderPremium.
 * При managerBonusShareEnabled добавляется 10% от бонусов управляемых аптек (managerBonusShare).
 * Фиксированная доплата (Employee.allowance) добавляется для любого типа сотрудника.
 */
async function calculateScheduleBasedSalary(
  employee: {
    id: number;
    name: string;
    baseSalary: unknown;
    fiveDaySalary?: unknown;
    pharmacies: { pharmacyId: number }[];
    allowance: unknown;
    allowanceDescription: string;
    employeeType?: string;
    workSchedule?: string | null;
    ladderPremiumEnabled?: boolean;
    managerBonusShareEnabled?: boolean;
    fiveDayViaAttendance?: boolean;
  },
  employeeType: string,
  month: number,
  year: number,
  pharmacyId: number | undefined,
  isManager: boolean,
): Promise<MonthlySalaryResult> {
  const dateFrom = startOfMonth(year, month);
  const dateTo = endOfMonth(year, month);

  const useLadder = isManager && Boolean(employee.ladderPremiumEnabled);
  const useBonusShare = isManager && Boolean(employee.managerBonusShareEnabled);
  const managedPharmacyIds = isManager ? resolveManagedPharmacyIds(employee, pharmacyId) : [];

  const entryFilter = {
    employeeId: employee.id,
    status: 'approved',
    date: { gte: dateFrom, lte: dateTo },
    ...(pharmacyId ? { pharmacyId } : {}),
  };

  const schedule = resolveWorkSchedule({ ...employee, employeeType });
  const readsShifts = usesRevenueShifts(schedule);
  const readsAttendance = usesAttendance(schedule);

  const [entries, pharmaBonusAgg, totalAdvances, totalSurcharges, calendarEntry, bonusShareStats, ladderStats, attendanceCount] =
    await Promise.all([
      // При чисто табельном графике записи выручки не читаются вовсе — как и раньше у
      // manager_fixed/pharmacy_manager: смен там быть не может, а бонусы аптеки таким
      // сотрудникам лично не начисляются.
      readsShifts
        ? prisma.dailyRevenueEntry.findMany({
            where: entryFilter,
            select: { pharmacyId: true, shiftType: true, cashRevenue: true, terminalRevenue: true, kaspiRevenue: true },
          })
        : Promise.resolve([] as { pharmacyId: number; shiftType: string | null; cashRevenue: unknown; terminalRevenue: unknown; kaspiRevenue: unknown }[]),
      readsShifts
        ? prisma.dailyExpenseItem.aggregate({
            _sum: { amount: true },
            where: { category: 'pharmaBonus', entry: entryFilter },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      computeAdvances(employee.id, month, year, pharmacyId),
      computeSurcharges(employee.id, month, year, pharmacyId),
      prisma.workingCalendar.findFirst({ where: { year, month }, select: { workingDays: true } }),
      useBonusShare
        ? computeManagerBonusShare(managedPharmacyIds, month, year)
        : Promise.resolve({ share: 0, total: 0 }),
      useLadder
        ? computeManagerLadderPremium(managedPharmacyIds, month, year)
        : Promise.resolve({ premium: 0, revenueTotal: 0 }),
      readsAttendance
        ? getAttendanceShiftsCount(employee.id, month, year, pharmacyId)
        : Promise.resolve(0),
    ]);

  const managerBonusShare = bonusShareStats.share;
  const managedBonusTotal = bonusShareStats.total;

  const baseSalary = Number(employee.baseSalary);
  let dayShiftsCount = 0;
  let fullDayShiftsCount = 0;
  let revenueTotal = 0;
  let revenueDayShifts = 0;
  let revenueFullDayShifts = 0;

  // Смены группируются по аптеке — у каждой аптеки своя настройка, считать премию
  // от личной выручки сотрудника или от средней выручки аптеки за смену (см. ниже).
  const byPharmacy = new Map<number, { dayCount: number; dayRevenue: number; fullDayCount: number; fullDayRevenue: number }>();

  for (const e of entries) {
    const revenue = Number(e.cashRevenue) + Number(e.terminalRevenue) + Number(e.kaspiRevenue ?? 0);
    // Личная премия продавца считается без kaspi — только по cash + terminal.
    const revenueForPremium = Number(e.cashRevenue) + Number(e.terminalRevenue);
    let grp = byPharmacy.get(e.pharmacyId);
    if (!grp) {
      grp = { dayCount: 0, dayRevenue: 0, fullDayCount: 0, fullDayRevenue: 0 };
      byPharmacy.set(e.pharmacyId, grp);
    }
    if (e.shiftType === 'day') {
      dayShiftsCount++;
      revenueDayShifts += revenue;
      grp.dayCount++;
      grp.dayRevenue += revenueForPremium;
    } else if (e.shiftType === 'full_day') {
      fullDayShiftsCount++;
      revenueFullDayShifts += revenue;
      grp.fullDayCount++;
      grp.fullDayRevenue += revenueForPremium;
    }
    // 'five_day' в записи выручки — устаревший способ, зарплату он больше не даёт вообще:
    // пятидневка сотрудника считается только через табель, см. ниже.
    revenueTotal += revenue;
  }

  const fiveDayShiftsCount = attendanceCount;

  // Оклад за пятидневные дни — отдельный от сменного. Если второй оклад не задан, берётся
  // основной: так считалось до появления поля, и у всех старых карточек оно пустое.
  const fiveDayBase =
    employee.fiveDaySalary !== null && employee.fiveDaySalary !== undefined
      ? Number(employee.fiveDaySalary)
      : baseSalary;

  const workingCalendarDays = calendarEntry?.workingDays ?? null;
  const salaryFromFullDayShifts = baseSalary > 0 ? (baseSalary / 10) * fullDayShiftsCount : 0;
  const salaryFromDayShifts = baseSalary > 0 ? (baseSalary / 15) * dayShiftsCount : 0;
  const salaryFromFiveDayShifts =
    fiveDayBase > 0 && workingCalendarDays ? (fiveDayBase / workingCalendarDays) * fiveDayShiftsCount : 0;
  const totalBonuses = Number(pharmaBonusAgg._sum.amount ?? 0);

  // Если включена лестничная премия аптеки — личная премия за выручку смены не начисляется.
  // Иначе — премия как у продавца (floor в 0 на каждый тип смены независимо), но для каждой
  // аптеки отдельно: если у аптеки включено poolAverageRevenuePremium — считается не от личной
  // выручки сотрудника за смену, а от средней выручки этой аптеки за смену того же типа за месяц.
  let revenuePremiumDayShifts = 0;
  let revenuePremiumFullDayShifts = 0;
  if (!useLadder && byPharmacy.size > 0) {
    const pharmacies = await prisma.pharmacy.findMany({
      where: { id: { in: [...byPharmacy.keys()] } },
      select: { id: true, poolAverageRevenuePremium: true },
    });
    const poolEnabled = new Set(pharmacies.filter((p) => p.poolAverageRevenuePremium).map((p) => p.id));

    for (const [phId, grp] of byPharmacy) {
      if (poolEnabled.has(phId)) {
        const { avgDayRevenue, avgFullDayRevenue } = await computePooledShiftAverages(phId, month, year);
        revenuePremiumDayShifts += Math.max(0, (avgDayRevenue - 200000) * 0.015) * grp.dayCount;
        revenuePremiumFullDayShifts += Math.max(0, (avgFullDayRevenue - 300000) * 0.015) * grp.fullDayCount;
      } else {
        revenuePremiumDayShifts += Math.max(0, (grp.dayRevenue - 200000 * grp.dayCount) * 0.015);
        revenuePremiumFullDayShifts += Math.max(0, (grp.fullDayRevenue - 300000 * grp.fullDayCount) * 0.015);
      }
    }
  }
  const totalRevenuePremium = revenuePremiumDayShifts + revenuePremiumFullDayShifts;

  const managerLadderPremium = ladderStats.premium;
  const managedRevenueTotal = ladderStats.revenueTotal;
  const allowance = Number(employee.allowance ?? 0);

  const totalSalary =
    salaryFromFullDayShifts +
    salaryFromDayShifts +
    salaryFromFiveDayShifts +
    totalBonuses +
    totalRevenuePremium +
    managerBonusShare +
    allowance +
    managerLadderPremium +
    totalSurcharges -
    totalAdvances;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeType,
    month,
    year,
    baseSalary,
    ...EMPTY_RESULT_BASE,
    workSchedule: schedule,
    fiveDaySalary: fiveDayBase,
    dayShiftsCount,
    fullDayShiftsCount,
    fiveDayShiftsCount,
    salaryFromDayShifts,
    salaryFromFullDayShifts,
    salaryFromFiveDayShifts,
    workingCalendarDays,
    revenuePremiumDayShifts,
    revenuePremiumFullDayShifts,
    totalRevenuePremium,
    totalBonuses,
    totalAdvances,
    totalSurcharges,
    attendanceShiftsCount: attendanceCount,
    managerBonusShare,
    managedBonusTotal,
    allowance,
    allowanceDescription: employee.allowanceDescription ?? '',
    managerLadderPremium,
    managedRevenueTotal,
    ladderPremiumEnabled: useLadder,
    managerBonusShareEnabled: useBonusShare,
    totalSalary,
    revenueTotal,
    recordsCount: entries.length + fiveDayShiftsCount,
  };
}

/** Уборщица: ставка за смену × количество отмеченных смен в табеле + фиксированная доплата. */
async function calculateCleanerSalary(
  employee: {
    id: number;
    name: string;
    baseSalary: unknown;
    shiftRate: unknown;
    allowance: unknown;
    allowanceDescription: string;
  },
  month: number,
  year: number,
  pharmacyId: number | undefined,
): Promise<MonthlySalaryResult> {
  const [attendanceShiftsCount, totalAdvances, totalSurcharges] = await Promise.all([
    getAttendanceShiftsCount(employee.id, month, year, pharmacyId),
    computeAdvances(employee.id, month, year, pharmacyId),
    computeSurcharges(employee.id, month, year, pharmacyId),
  ]);

  const shiftRate = employee.shiftRate !== null && employee.shiftRate !== undefined ? Number(employee.shiftRate) : null;
  const salaryFromShiftRate = shiftRate ? shiftRate * attendanceShiftsCount : 0;
  const allowance = Number(employee.allowance ?? 0);
  const totalSalary = salaryFromShiftRate + allowance + totalSurcharges - totalAdvances;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeType: 'cleaner',
    month,
    year,
    baseSalary: Number(employee.baseSalary),
    ...EMPTY_RESULT_BASE,
    attendanceShiftsCount,
    shiftRate,
    salaryFromShiftRate,
    allowance,
    allowanceDescription: employee.allowanceDescription ?? '',
    totalAdvances,
    totalSurcharges,
    totalSalary,
    recordsCount: attendanceShiftsCount,
  };
}

/** Офис: пятидневка по табелю посещаемости + лестничная премия от выручки всех аптек + доплата. */
async function calculateOfficeSalary(
  employee: { id: number; name: string; baseSalary: unknown; allowance: unknown; allowanceDescription: string },
  month: number,
  year: number,
): Promise<MonthlySalaryResult> {
  const [attendanceShiftsCount, calendarEntry, totalAdvances, totalSurcharges, officeStats] = await Promise.all([
    getAttendanceShiftsCount(employee.id, month, year),
    prisma.workingCalendar.findFirst({ where: { year, month }, select: { workingDays: true } }),
    computeAdvances(employee.id, month, year),
    computeSurcharges(employee.id, month, year),
    computeOfficeLadderPremium(month, year),
  ]);

  const baseSalary = Number(employee.baseSalary);
  const workingCalendarDays = calendarEntry?.workingDays ?? null;
  const salaryFromFiveDayShifts =
    baseSalary > 0 && workingCalendarDays ? (baseSalary / workingCalendarDays) * attendanceShiftsCount : 0;
  const allowance = Number(employee.allowance ?? 0);

  const totalSalary = salaryFromFiveDayShifts + officeStats.premium + allowance + totalSurcharges - totalAdvances;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeType: 'office',
    month,
    year,
    baseSalary,
    ...EMPTY_RESULT_BASE,
    fiveDaySalary: baseSalary,
    fiveDayShiftsCount: attendanceShiftsCount,
    salaryFromFiveDayShifts,
    workingCalendarDays,
    attendanceShiftsCount,
    totalAdvances,
    totalSurcharges,
    allowance,
    allowanceDescription: employee.allowanceDescription ?? '',
    managerLadderPremium: officeStats.premium,
    managedRevenueTotal: officeStats.revenueTotal,
    totalSalary,
    recordsCount: attendanceShiftsCount,
  };
}

/**
 * Рассчитывает зарплату сотрудника за указанный месяц.
 *
 * Два типа считаются по собственным правилам:
 *  - cleaner — ставка за смену × количество смен в табеле − авансы (оклад не участвует)
 *  - office  — пятидневка по табелю + премия по таблице диапазонов от выручки ВСЕХ аптек
 *
 * Остальные (seller / manager_trading / manager_fixed / pharmacy_manager) считаются одной
 * общей формулой (calculateScheduleBasedSalary). Откуда берутся отработанные дни — определяет
 * не тип сотрудника, а его график (Employee.workSchedule): смены в записях выручки, отметки
 * табеля или и то, и другое сразу. У manager_* дополнительно действуют два независимых
 * переключателя — ladderPremiumEnabled (лестничная премия аптеки вместо личной премии за
 * выручку смены) и managerBonusShareEnabled (10% от бонусов управляемых аптек), в любой
 * комбинации. Фиксированная доплата (Employee.allowance) добавляется к итогу для любого типа.
 *
 * Учитывает только записи/начисления со статусом 'approved'. Если передан pharmacyId — фильтрует по аптеке
 * (для office фильтр по аптеке не применяется, премия всегда считается от всех аптек).
 */
export async function calculateEmployeeMonthlySalary(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<MonthlySalaryResult | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { pharmacies: true },
  });
  if (!employee) return null;

  const employeeType = (employee as { employeeType?: string }).employeeType ?? 'seller';

  if (employeeType === 'cleaner') {
    return calculateCleanerSalary(
      employee as unknown as {
        id: number;
        name: string;
        baseSalary: unknown;
        shiftRate: unknown;
        allowance: unknown;
        allowanceDescription: string;
      },
      month,
      year,
      pharmacyId,
    );
  }
  if (employeeType === 'office') {
    return calculateOfficeSalary(employee, month, year);
  }

  return calculateScheduleBasedSalary(
    employee as unknown as {
      id: number;
      name: string;
      baseSalary: unknown;
      fiveDaySalary: unknown;
      pharmacies: { pharmacyId: number }[];
      allowance: unknown;
      allowanceDescription: string;
      workSchedule: string | null;
      ladderPremiumEnabled: boolean;
      managerBonusShareEnabled: boolean;
      fiveDayViaAttendance: boolean;
    },
    employeeType,
    month,
    year,
    pharmacyId,
    MANAGER_TYPES.has(employeeType),
  );
}

/**
 * Возвращает список смен сотрудника за месяц с деталями по каждой записи.
 * Применимо к seller / manager_trading (у них смены привязаны к DailyRevenueEntry).
 */
export async function getEmployeeMonthlyShifts(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<ShiftEntry[]> {
  const where: Record<string, unknown> = {
    employeeId,
    status: 'approved',
    date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
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

/**
 * Возвращает список отметок табеля посещаемости сотрудника за месяц.
 * Применимо к manager_fixed / cleaner / office.
 */
export async function getEmployeeMonthlyAttendance(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<AttendanceEntry[]> {
  const shifts = await prisma.attendanceShift.findMany({
    where: {
      employeeId,
      date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
      ...(pharmacyId ? { pharmacyId } : {}),
    },
    include: { pharmacy: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  return shifts.map((s) => ({
    id: s.id,
    date: s.date,
    pharmacyId: s.pharmacyId,
    pharmacyName: s.pharmacy?.name ?? null,
    overtimeHours: Number(s.overtimeHours),
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
  const items = await prisma.dailyExpenseItem.findMany({
    where: {
      category: 'employeeAdvance',
      employeeId,
      entry: {
        status: 'approved',
        date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
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

export interface SurchargeEntry {
  id: number;
  date: Date;
  pharmacyName: string;
  amount: number;
  comment: string | null;
}

/**
 * Возвращает список доплат, выданных сотруднику за месяц (category='employeeSurcharge').
 * Как и аванс, доплата привязана к сотруднику напрямую (DailyExpenseItem.employeeId) —
 * может быть записана в записи выручки другого сотрудника этой аптеки. В отличие от
 * pharmaBonus, в общий котёл для доли заведующей не входит.
 */
export async function getEmployeeMonthlySurcharges(
  employeeId: number,
  month: number,
  year: number,
  pharmacyId?: number,
): Promise<SurchargeEntry[]> {
  const items = await prisma.dailyExpenseItem.findMany({
    where: {
      category: 'employeeSurcharge',
      employeeId,
      entry: {
        status: 'approved',
        date: { gte: startOfMonth(year, month), lte: endOfMonth(year, month) },
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
    if (!result) continue;
    // Заведующие и менеджеры (USER_LINKED_TYPES) получают доплату/премию независимо
    // от того, торговали или отрабатывали смену лично в этом периоде — поэтому их
    // не фильтруем по recordsCount, как продавцов/уборщиц.
    const isManagerLike = USER_LINKED_TYPES.has(result.employeeType);
    if (isManagerLike || result.recordsCount > 0) {
      results.push(result);
    }
  }
  return results;
}
