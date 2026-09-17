import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { buildCashReport, CashReportSourceEntry } from '@/lib/cash-report-builder';
import { buildCashReportWorkbook } from '@/lib/cash-report-excel';

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
  // Отчёт по кассе — это сверка реальных наличных. В неё входят только подтверждённые и не
  // исключённые из отчёта записи: раньше по умолчанию брались все, кроме pending, и отклонённые
  // (устаревший статус) вместе с исключёнными дублями попадали в «ИТОГО ЗА ПЕРИОД» — сверка
  // сходилась с несуществующими операциями (QA раунд 4, №3). Явный ?status= (например, pending,
  // чтобы посмотреть, что ещё не проверено) по-прежнему уважается.
  where.status = status || 'approved';
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

  const sections = buildCashReport(sourceEntries);
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
