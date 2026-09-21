import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { buildCashReport, CashReportSourceEntry, CashReportDayBalance } from '@/lib/cash-report-builder';
import { buildCashReportWorkbook } from '@/lib/cash-report-excel';
import { loadCashBalance } from '@/lib/cash-balance-query';

/** Остаток берётся тем же расчётом, что и на странице выручки, — иначе Excel и экран разойдутся. */
async function buildBalancesByPharmacy(pharmacyIds: number[], from: string | null, to: string | null) {
  const result = new Map<number, Map<string, CashReportDayBalance>>();

  for (const pharmacyId of pharmacyIds) {
    const balance = await loadCashBalance(pharmacyId, from ?? undefined, to ?? undefined);
    if (!balance) continue;

    result.set(
      pharmacyId,
      new Map(balance.days.map((d) => [d.date, {
        openingBalance: d.openingBalance,
        deposit: d.deposit,
        closingBalance: d.closingBalance,
      }]))
    );
  }

  return result;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const pharmacyId = searchParams.get('pharmacyId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const status = searchParams.get('status');

  const where: Record<string, unknown> = {};
  if (pharmacyId) where.pharmacyId = Number(pharmacyId);
  // Как и в таблице /revenue: по умолчанию подтверждённые и на проверке — ровно то, что
  // считает касса (деньги из кассы по ним уже вышли, подтверждение — не факт о движении денег).
  // Отклонённая запись недействительна, денег по ней не было. excludedFromReport — бухгалтер
  // вычеркнул запись как ошибочную/дубль (QA раунд 4, №3): такая запись тоже не в счёт.
  if (status) where.status = status;
  else where.status = { not: 'rejected' };
  where.excludedFromReport = false;
  if (from || to) {
    const date: Record<string, Date> = {};
    if (from) date.gte = new Date(`${from}T00:00:00`);
    if (to) date.lte = new Date(`${to}T23:59:59`);
    where.date = date;
  }

  const entries = await prisma.dailyRevenueEntry.findMany({
    where,
    include: {
      pharmacy: true,
      expenseItems: { include: { employee: { select: { name: true } } }, orderBy: { id: 'asc' } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const sourceEntries: CashReportSourceEntry[] = entries.map((e) => ({
    id: e.id,
    date: e.date,
    status: e.status,
    employeeName: e.employeeName,
    cashRevenue: Number(e.cashRevenue),
    terminalRevenue: Number(e.terminalRevenue),
    kaspiRevenue: Number(e.kaspiRevenue ?? 0),
    pharmacy: { id: e.pharmacy.id, name: e.pharmacy.name },
    expenseItems: e.expenseItems.map((i) => ({
      category: i.category,
      amount: Number(i.amount),
      comment: i.comment,
      employee: i.employee ? { name: i.employee.name } : null,
    })),
  }));

  const balances = await buildBalancesByPharmacy(
    [...new Set(entries.map((e) => e.pharmacyId))],
    from,
    to
  );
  const sections = buildCashReport(sourceEntries, balances);
  const workbook = await buildCashReportWorkbook(sections, { from, to, statusFilter: status });
  const buffer = await workbook.xlsx.writeBuffer();

  const fileNameParts = ['cash-report', from, to].filter(Boolean);
  const fileName = `${fileNameParts.join('_')}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
