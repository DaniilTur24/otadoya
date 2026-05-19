import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MONTHLY_EXPENSE_KEYS } from '@/lib/monthly-report-fields';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year  = Number(searchParams.get('year')  || new Date().getFullYear());
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);

  const dateFrom = new Date(year, month - 1, 1);
  const dateTo   = new Date(year, month, 0, 23, 59, 59, 999);

  const [pharmacies, revenueEntries, expenseEntries, importedValues, overrides, pdfReports, shiftEntries] = await Promise.all([
    prisma.pharmacy.findMany({ orderBy: { name: 'asc' } }),
    prisma.dailyRevenueEntry.findMany({
      where: { status: 'approved', date: { gte: dateFrom, lte: dateTo } },
      include: { expenseItems: true },
    }),
    prisma.extractedExpenseEntry.findMany({
      where: { status: 'approved', operationDate: { gte: dateFrom, lte: dateTo } },
    }),
    prisma.importedReportValue.findMany({
      where: {
        status: 'approved',
        upload: {
          fileType: 'bank_transactions_excel',
          year,
          month,
        },
      },
    }),
    prisma.monthlyReportOverride.findMany({ where: { year, month } }),
    prisma.pharmacyPdfReport.findMany({ where: { year, month, status: 'confirmed' } }),
    // Записи с привязанным сотрудником и типом смены — для расчёта окладной части
    prisma.dailyRevenueEntry.findMany({
      where: {
        status: 'approved',
        date: { gte: dateFrom, lte: dateTo },
        employeeId: { not: null },
        shiftType: { in: ['day', 'full_day'] },
      },
      include: { employee: { select: { baseSalary: true } } },
    }),
  ]);

  // Системные значения по аптекам
  type Row = Record<string, number>;
  const systemData: Record<number, Row> = {};

  for (const p of pharmacies) {
    systemData[p.id] = {
      retailRevenue: 0, kaspiRevenue: 0, wholesaleRevenue: 0, coefficient: Number(p.coefficient ?? 0),
      avgDailyRevenue: 0, terminalRent: 0, procedureRent: 0, legalEntityProfit: 0,
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
    const kaspi = Number((e as unknown as Record<string, unknown>).kaspiRevenue ?? 0);
    systemData[e.pharmacyId].retailRevenue += Number(e.cashRevenue) + Number(e.terminalRevenue) + kaspi;
    systemData[e.pharmacyId].kaspiRevenue  += kaspi;

    // Расходы распределяем по выбранной категории; старые записи без категории → otherExpenses
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

  // Оклады сотрудников по сменам (без бонусов — они уже в pharmaBonus через expenseItems)
  // pharmaSalary = baseSalary/15 * дневных смен + baseSalary/10 * суточных смен
  for (const e of shiftEntries) {
    if (!e.employee || !systemData[e.pharmacyId]) continue;
    const base = Number(e.employee.baseSalary);
    if (e.shiftType === 'day')      systemData[e.pharmacyId].pharmaSalary += base / 15;
    else if (e.shiftType === 'full_day') systemData[e.pharmacyId].pharmaSalary += base / 10;
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

  const totalOnlyData: Record<string, number> = {};
  for (const value of importedValues) {
    const amount = Number(value.amount);
    if (value.pharmacyId && systemData[value.pharmacyId] && value.fieldKey in systemData[value.pharmacyId]) {
      systemData[value.pharmacyId][value.fieldKey] += amount;
    } else if (!value.pharmacyId) {
      totalOnlyData[value.fieldKey] = (totalOnlyData[value.fieldKey] ?? 0) + amount;
    }
  }

  // Подставляем данные из PDF-отчётов (подтверждённых)
  for (const r of pdfReports) {
    if (!systemData[r.pharmacyId]) continue;
    const d = systemData[r.pharmacyId];
    if (r.stockRetail    != null) d.stockRetail    = Number(r.stockRetail);
    if (r.stockWholesale != null) d.stockWholesale = Number(r.stockWholesale);
    // Наценка от выручки 34,18% → коэффициент 1.34 (= round(1 + markup/100, 2))
    if (r.markupPercent  != null) d.coefficient    = Math.round((1 + Number(r.markupPercent) / 100) * 100) / 100;
  }

  for (const p of pharmacies) {
    const d = systemData[p.id];
    d.totalExpenses = MONTHLY_EXPENSE_KEYS.reduce((s, k) => s + d[k], 0);
    d.netIncome     = d.retailRevenue - d.totalExpenses;
  }

  // Словарь overrides: "pharmacyId:fieldKey" → value
  const overrideMap: Record<string, number> = {};
  for (const o of overrides) {
    overrideMap[`${o.pharmacyId}:${o.fieldKey}`] = Number(o.value);
  }

  return NextResponse.json({ pharmacies, systemData, overrideMap, totalOnlyData });
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
