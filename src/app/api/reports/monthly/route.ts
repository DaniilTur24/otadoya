import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year  = Number(searchParams.get('year')  || new Date().getFullYear());
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);

  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59, 999);

  const [pharmacies, revenueEntries, expenseEntries, overrides] = await Promise.all([
    prisma.pharmacy.findMany({ orderBy: { name: 'asc' } }),
    prisma.dailyRevenueEntry.findMany({
      where: { status: 'approved', date: { gte: dateFrom, lte: dateTo } },
      include: { expenseItems: true },
    }),
    prisma.extractedExpenseEntry.findMany({
      where: { status: 'approved', operationDate: { gte: dateFrom, lte: dateTo } },
    }),
    prisma.monthlyReportOverride.findMany({ where: { year, month } }),
  ]);

  // Системные значения по аптекам
  type Row = Record<string, number>;
  const systemData: Record<number, Row> = {};

  for (const p of pharmacies) {
    systemData[p.id] = {
      retailRevenue: 0, kaspiRevenue: 0, wholesaleRevenue: 0, coefficient: Number(p.coefficient ?? 0),
      avgDailyRevenue: 0, terminalRent: Number(p.terminalRent ?? 0), procedureRent: Number(p.procedureRent ?? 0), legalEntityProfit: 0,
      stockRetail: 0, stockWholesale: 0, consignment: 0, consignmentOverdue: 0,
      goodsExpenses: 0, pharmaBonus: 0, pharmaSalary: 0, officeSalary: 0,
      association: 0, charity: 0, accountingServices: 0, stationery: 0,
      utilities: 0, deferredTax: 0, vat: 0, security: 0,
      otherExpenses: 0, householdExpenses: 0, advertising: 0, repairs: 0,
      rentExpenses: 0, fixedAssets: 0, standardKaspibot: 0, daribar: 0,
      communications: 0, equipment: 0, transport: 0, cleaning: 0, bankServices: 0,
      totalExpenses: 0, netIncome: 0, divideBy2: 0, directorShare: 0,
    };
  }

  for (const e of revenueEntries) {
    if (!systemData[e.pharmacyId]) continue;
    systemData[e.pharmacyId].retailRevenue += Number(e.cashRevenue) + Number(e.terminalRevenue);
    systemData[e.pharmacyId].pharmaBonus   += Number((e as unknown as Record<string, unknown>).bonusRevenue ?? 0);
    systemData[e.pharmacyId].otherExpenses += Number(e.additionalExpenses);
  }

  // Считаем оптовую выручку: розничная / коэффициент
  for (const p of pharmacies) {
    const d = systemData[p.id];
    if (d.coefficient > 0) {
      d.wholesaleRevenue = Math.round(d.retailRevenue / d.coefficient);
    }
  }

  for (const e of expenseEntries) {
    if (!e.pharmacyId || !systemData[e.pharmacyId]) continue;
    if (e.category === 'rent')    systemData[e.pharmacyId].rentExpenses  += Number(e.amount);
    if (e.category === 'expense') systemData[e.pharmacyId].bankServices  += Number(e.amount);
  }

  // Считаем итоги из системных данных
  const EXPENSE_KEYS = [
    'goodsExpenses','pharmaBonus','pharmaSalary','officeSalary','association','charity',
    'accountingServices','stationery','utilities','deferredTax','vat','security',
    'otherExpenses','householdExpenses','advertising','repairs','rentExpenses',
    'fixedAssets','standardKaspibot','daribar','communications','equipment',
    'transport','cleaning','bankServices','terminalRent','procedureRent',
  ];

  for (const p of pharmacies) {
    const d = systemData[p.id];
    d.totalExpenses = EXPENSE_KEYS.reduce((s, k) => s + d[k], 0);
    d.netIncome     = d.retailRevenue - d.totalExpenses;
  }

  // Словарь overrides: "pharmacyId:fieldKey" → value
  const overrideMap: Record<string, number> = {};
  for (const o of overrides) {
    overrideMap[`${o.pharmacyId}:${o.fieldKey}`] = Number(o.value);
  }

  return NextResponse.json({ pharmacies, systemData, overrideMap });
}

// PUT — сохранить или удалить override для одной ячейки
// Body: { year, month, pharmacyId, fieldKey, value }
// value === null → удалить override (сброс на системное значение)
export async function PUT(request: NextRequest) {
  const { year, month, pharmacyId, fieldKey, value } = await request.json();

  if (value === null || value === undefined) {
    await prisma.monthlyReportOverride.deleteMany({
      where: { year, month, pharmacyId: Number(pharmacyId), fieldKey },
    });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const override = await prisma.monthlyReportOverride.upsert({
    where: { year_month_pharmacyId_fieldKey: {
      year, month, pharmacyId: Number(pharmacyId), fieldKey,
    }},
    update: { value: String(value) },
    create: { year, month, pharmacyId: Number(pharmacyId), fieldKey, value: String(value) },
  });

  return NextResponse.json({ ok: true, value: Number(override.value) });
}
