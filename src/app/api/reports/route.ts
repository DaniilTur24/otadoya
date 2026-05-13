import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const pharmacyId = searchParams.get('pharmacyId');
  // По умолчанию отчёт строится только по подтверждённым записям
  const status = searchParams.get('status') || 'approved';

  // Фильтр по датам для записей выручки
  const revenueWhere: Record<string, unknown> = {};
  if (status !== 'all') revenueWhere.status = status;
  if (pharmacyId) revenueWhere.pharmacyId = Number(pharmacyId);
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      dateFilter.lte = d;
    }
    revenueWhere.date = dateFilter;
  }

  // Фильтр по датам для расходов из файлов
  const expenseWhere: Record<string, unknown> = {};
  if (status !== 'all') expenseWhere.status = status;
  if (pharmacyId) expenseWhere.pharmacyId = Number(pharmacyId);
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setHours(23, 59, 59, 999);
      dateFilter.lte = d;
    }
    expenseWhere.operationDate = dateFilter;
  }

  const [revenueEntries, expenseEntries, allPharmacies] = await Promise.all([
    prisma.dailyRevenueEntry.findMany({
      where: revenueWhere,
      include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
      orderBy: { date: 'desc' },
    }),
    prisma.extractedExpenseEntry.findMany({
      where: expenseWhere,
      include: { file: true },
      orderBy: { operationDate: 'desc' },
    }),
    prisma.pharmacy.findMany({ orderBy: { name: 'asc' } }),
  ]);

  // Агрегируем по аптекам
  const pharmacyMap = new Map<
    number,
    {
      id: number;
      name: string;
      cashRevenue: number;
      terminalRevenue: number;
      additionalExpenses: number;
      fileExpenses: number;
      fileRent: number;
      entryCount: number;
    }
  >();

  // Инициализируем все аптеки (чтобы они были в отчёте даже без записей)
  for (const p of allPharmacies) {
    if (pharmacyId && p.id !== Number(pharmacyId)) continue;
    pharmacyMap.set(p.id, {
      id: p.id,
      name: p.name,
      cashRevenue: 0,
      terminalRevenue: 0,
      additionalExpenses: 0,
      fileExpenses: 0,
      fileRent: 0,
      entryCount: 0,
    });
  }

  for (const entry of revenueEntries) {
    if (!pharmacyMap.has(entry.pharmacyId)) {
      pharmacyMap.set(entry.pharmacyId, {
        id: entry.pharmacyId,
        name: entry.pharmacy.name,
        cashRevenue: 0,
        terminalRevenue: 0,
        additionalExpenses: 0,
        fileExpenses: 0,
        fileRent: 0,
        entryCount: 0,
      });
    }
    const stats = pharmacyMap.get(entry.pharmacyId)!;
    stats.cashRevenue += Number(entry.cashRevenue);
    stats.terminalRevenue += Number(entry.terminalRevenue);
    stats.additionalExpenses += Number(entry.additionalExpenses);
    stats.entryCount++;
  }

  for (const entry of expenseEntries) {
    if (!entry.pharmacyId) continue;
    const stats = pharmacyMap.get(entry.pharmacyId);
    if (!stats) continue;
    if (entry.category === 'expense') stats.fileExpenses += Number(entry.amount);
    if (entry.category === 'rent') stats.fileRent += Number(entry.amount);
  }

  // Расходы без привязки к аптеке (pharmacyId == null)
  const unlinkedExpenses = expenseEntries.filter((e) => !e.pharmacyId);
  const unlinkedTotal = {
    fileExpenses: unlinkedExpenses
      .filter((e) => e.category === 'expense')
      .reduce((s, e) => s + Number(e.amount), 0),
    fileRent: unlinkedExpenses
      .filter((e) => e.category === 'rent')
      .reduce((s, e) => s + Number(e.amount), 0),
  };

  const byPharmacy = Array.from(pharmacyMap.values())
    .filter((p) => p.entryCount > 0 || p.fileExpenses > 0 || p.fileRent > 0)
    .map((p) => ({
      ...p,
      totalRevenue: p.cashRevenue + p.terminalRevenue,
      totalExpenses: p.additionalExpenses + p.fileExpenses + p.fileRent,
      netResult:
        p.cashRevenue +
        p.terminalRevenue -
        (p.additionalExpenses + p.fileExpenses + p.fileRent),
    }));

  // Итоговые суммы по аптекам (без непривязанных расходов)
  const pharmacyTotals = byPharmacy.reduce(
    (acc, p) => ({
      cashRevenue: acc.cashRevenue + p.cashRevenue,
      terminalRevenue: acc.terminalRevenue + p.terminalRevenue,
      totalRevenue: acc.totalRevenue + p.totalRevenue,
      additionalExpenses: acc.additionalExpenses + p.additionalExpenses,
      fileExpenses: acc.fileExpenses + p.fileExpenses,
      fileRent: acc.fileRent + p.fileRent,
      totalExpenses: acc.totalExpenses + p.totalExpenses,
      netResult: acc.netResult + p.netResult,
    }),
    {
      cashRevenue: 0, terminalRevenue: 0, totalRevenue: 0,
      additionalExpenses: 0, fileExpenses: 0, fileRent: 0,
      totalExpenses: 0, netResult: 0,
    }
  );

  // Непривязанные расходы добавляем в итого ОДИН РАЗ (не внутри reduce)
  const totals = {
    ...pharmacyTotals,
    fileExpenses: pharmacyTotals.fileExpenses + unlinkedTotal.fileExpenses,
    fileRent: pharmacyTotals.fileRent + unlinkedTotal.fileRent,
    totalExpenses:
      pharmacyTotals.totalExpenses +
      unlinkedTotal.fileExpenses +
      unlinkedTotal.fileRent,
    netResult:
      pharmacyTotals.netResult -
      unlinkedTotal.fileExpenses -
      unlinkedTotal.fileRent,
  };

  // Детальные записи для отображения в таблице
  const revenueDetails = revenueEntries.map((e) => ({
    ...e,
    cashRevenue: Number(e.cashRevenue),
    terminalRevenue: Number(e.terminalRevenue),
    additionalExpenses: Number(e.additionalExpenses),
    totalRevenue: Number(e.cashRevenue) + Number(e.terminalRevenue),
    expenseItems: e.expenseItems.map((i) => ({
      ...i,
      amount: Number(i.amount),
    })),
  }));

  const expenseDetails = expenseEntries.map((e) => ({
    ...e,
    amount: Number(e.amount),
  }));

  return NextResponse.json({
    byPharmacy,
    totals,
    unlinkedTotal,
    revenueDetails,
    expenseDetails,
  });
}
