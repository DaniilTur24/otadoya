import { prisma } from '@/lib/prisma';
import { MONTHLY_EXPENSE_KEYS, MONTHLY_REPORT_ROWS } from '@/lib/monthly-report-fields';

type Row = Record<string, number>;
type SystemData = Record<number, Row>;
type OverrideMap = Record<string, number>;

export type MonthlyData = {
  pharmacies: { id: number; name: string; coefficient: unknown; terminalRent: unknown; procedureRent: unknown; isActive: boolean }[];
  systemData: SystemData;
  overrideMap: OverrideMap;
};

export async function computeMonthlyData(year: number, month: number): Promise<MonthlyData> {
  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59, 999);

  const [pharmacies, revenueEntries, expenseEntries, importedValues, overrides, pdfReports, shiftEntries] = await Promise.all([
    prisma.pharmacy.findMany({ orderBy: { name: 'asc' } }),
    prisma.dailyRevenueEntry.findMany({
      where: { status: 'approved', excludedFromReport: false, date: { gte: dateFrom, lte: dateTo } },
      include: { expenseItems: true },
    }),
    prisma.extractedExpenseEntry.findMany({
      where: { status: 'approved', operationDate: { gte: dateFrom, lte: dateTo } },
    }),
    prisma.importedReportValue.findMany({
      where: {
        status: 'approved',
        upload: { fileType: 'bank_transactions_excel', year, month },
      },
    }),
    prisma.monthlyReportOverride.findMany({ where: { year, month } }),
    prisma.pharmacyPdfReport.findMany({ where: { year, month, status: 'confirmed' } }),
    prisma.dailyRevenueEntry.findMany({
      where: {
        status: 'approved',
        excludedFromReport: false,
        date: { gte: dateFrom, lte: dateTo },
        employeeId: { not: null },
        shiftType: { in: ['day', 'full_day'] },
      },
      include: { employee: { select: { baseSalary: true } } },
    }),
  ]);

  const systemData: SystemData = {};

  for (const p of pharmacies) {
    systemData[p.id] = {
      retailRevenue: 0, kaspiRevenue: 0, wholesaleRevenue: 0, coefficient: Number(p.coefficient ?? 0),
      avgDailyRevenue: 0, terminalRent: Number(p.terminalRent ?? 0), procedureRent: Number(p.procedureRent ?? 0),
      legalEntityProfit: 0, stockRetail: 0, stockWholesale: 0, consignment: 0, consignmentOverdue: 0,
      goodsExpenses: 0, pharmaBonus: 0, employeeAdvance: 0, pharmaSalary: 0, officeSalary: 0,
      association: 0, charity: 0, accountingServices: 0, stationery: 0,
      utilities: 0, deferredTax: 0, vat: 0, security: 0,
      otherExpenses: 0, householdExpenses: 0, advertising: 0, repairs: 0,
      rentExpenses: 0, standardKaspibot: 0, daribar: 0,
      communications: 0, equipment: 0, transport: 0, cleaning: 0, bankServices: 0,
      totalExpenses: 0, netIncome: 0, divideBy2: 0, directorShare: 0,
    };
  }

  for (const e of revenueEntries) {
    if (!systemData[e.pharmacyId]) continue;
    const kaspi = Number((e as unknown as Record<string, unknown>).kaspiRevenue ?? 0);
    systemData[e.pharmacyId].retailRevenue += Number(e.cashRevenue) + Number(e.terminalRevenue) + kaspi;
    systemData[e.pharmacyId].kaspiRevenue  += kaspi;

    for (const item of e.expenseItems) {
      const cat = (item as unknown as Record<string, unknown>).category as string | null;
      const amt = Number(item.amount);
      if (cat && cat in systemData[e.pharmacyId]) {
        systemData[e.pharmacyId][cat] += amt;
      } else {
        systemData[e.pharmacyId].otherExpenses += amt;
      }
    }
  }

  for (const e of shiftEntries) {
    if (!e.employee || !systemData[e.pharmacyId]) continue;
    const base = Number(e.employee.baseSalary);
    if (e.shiftType === 'day')           systemData[e.pharmacyId].pharmaSalary += base / 15;
    else if (e.shiftType === 'full_day') systemData[e.pharmacyId].pharmaSalary += base / 10;
  }

  for (const p of pharmacies) {
    const d = systemData[p.id];
    if (d.coefficient > 0) {
      d.wholesaleRevenue = Math.round(d.retailRevenue / d.coefficient);
    }
  }

  for (const e of expenseEntries) {
    if (!e.pharmacyId || !systemData[e.pharmacyId]) continue;
    if (e.category === 'rent')    systemData[e.pharmacyId].rentExpenses += Number(e.amount);
    if (e.category === 'expense') systemData[e.pharmacyId].bankServices += Number(e.amount);
  }

  for (const value of importedValues) {
    const amount = Number(value.amount);
    if (value.pharmacyId && systemData[value.pharmacyId] && value.fieldKey in systemData[value.pharmacyId]) {
      systemData[value.pharmacyId][value.fieldKey] += amount;
    }
  }

  for (const r of pdfReports) {
    if (!systemData[r.pharmacyId]) continue;
    const d = systemData[r.pharmacyId];
    if (r.stockRetail    != null) d.stockRetail    = Number(r.stockRetail);
    if (r.stockWholesale != null) d.stockWholesale = Number(r.stockWholesale);
    if (r.markupPercent  != null) d.coefficient    = Math.round((1 + Number(r.markupPercent) / 100) * 100) / 100;
  }

  for (const p of pharmacies) {
    const d = systemData[p.id];
    d.totalExpenses = MONTHLY_EXPENSE_KEYS.reduce((s, k) => s + d[k], 0);
    d.netIncome     = d.retailRevenue - d.totalExpenses;
  }

  const overrideMap: OverrideMap = {};
  for (const o of overrides) {
    overrideMap[`${o.pharmacyId}:${o.fieldKey}`] = Number(o.value);
  }

  return { pharmacies, systemData, overrideMap };
}

function resolveValue(
  pharmacyId: number,
  key: string,
  systemData: SystemData,
  overrideMap: OverrideMap
): number {
  const ovKey = `${pharmacyId}:${key}`;
  if (overrideMap[ovKey] !== undefined) return overrideMap[ovKey];

  if (key === 'wholesaleRevenue') {
    const coeff = resolveValue(pharmacyId, 'coefficient', systemData, overrideMap);
    if (coeff > 0) return Math.round(resolveValue(pharmacyId, 'retailRevenue', systemData, overrideMap) / coeff);
    return 0;
  }

  if (key === 'totalExpenses') {
    const expKeys = MONTHLY_REPORT_ROWS.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
    return expKeys.reduce((s, k) => s + resolveValue(pharmacyId, k, systemData, overrideMap), 0);
  }

  if (key === 'netIncome') {
    const incKeys = MONTHLY_REPORT_ROWS.filter((r) => r.rowType === 'income' && !r.section).map((r) => r.key);
    const expKeys = MONTHLY_REPORT_ROWS.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
    return (
      incKeys.reduce((s, k) => s + resolveValue(pharmacyId, k, systemData, overrideMap), 0) -
      expKeys.reduce((s, k) => s + resolveValue(pharmacyId, k, systemData, overrideMap), 0)
    );
  }

  return systemData[pharmacyId]?.[key] ?? 0;
}

export function buildMonthlySnapshot(
  pharmacies: { id: number }[],
  systemData: SystemData,
  overrideMap: OverrideMap
): Record<string, Record<string, number>> {
  const snapshot: Record<string, Record<string, number>> = {};
  for (const p of pharmacies) {
    snapshot[String(p.id)] = {};
    for (const row of MONTHLY_REPORT_ROWS) {
      if (row.section) continue;
      snapshot[String(p.id)][row.key] = resolveValue(p.id, row.key, systemData, overrideMap);
    }
  }
  return snapshot;
}
