import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';

async function isMonthClosed(date: Date): Promise<boolean> {
  const year  = date.getFullYear();
  const month = date.getMonth() + 1;
  const closed = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
  return !!closed;
}

function serialize(entry: Record<string, unknown>) {
  const items = (entry.expenseItems as { amount: unknown; comment: unknown }[] | undefined) ?? [];
  return {
    ...entry,
    cashRevenue: Number(entry.cashRevenue),
    terminalRevenue: Number(entry.terminalRevenue),
    kaspiRevenue: Number(entry.kaspiRevenue ?? 0),
    bonusRevenue: Number(entry.bonusRevenue ?? 0),
    additionalExpenses: Number(entry.additionalExpenses),
    totalRevenue: Number(entry.cashRevenue) + Number(entry.terminalRevenue) + Number(entry.kaspiRevenue ?? 0),
    expenseItems: items.map((i) => ({ ...i, amount: Number(i.amount) })),
  };
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const entry = await prisma.dailyRevenueEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  if (await isMonthClosed(entry.date)) {
    return NextResponse.json({ error: 'Месяц закрыт — удаление невозможно' }, { status: 423 });
  }

  await prisma.dailyRevenueEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const existing = await prisma.dailyRevenueEntry.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  if (await isMonthClosed(existing.date)) {
    return NextResponse.json({ error: 'Месяц закрыт — изменения невозможны' }, { status: 423 });
  }

  const body = await request.json();
  const {
    pharmacyId, date, cashRevenue, terminalRevenue, kaspiRevenue, bonusRevenue,
    expenseItems, generalComment, employeeName, employeeId, shiftType,
    bookkeeperComment, status, excludedFromReport,
  } = body;

  const VALID_STATUSES = ['pending', 'approved', 'rejected'];
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Некорректный статус: ${status}` }, { status: 400 });
  }

  // Скалярные поля записи
  const data: Record<string, unknown> = {};
  if (pharmacyId != null) data.pharmacyId = Number(pharmacyId);
  if (date) data.date = new Date(date);
  if (cashRevenue != null) data.cashRevenue = String(cashRevenue);
  if (terminalRevenue != null) data.terminalRevenue = String(terminalRevenue);
  if (kaspiRevenue != null) data.kaspiRevenue = String(kaspiRevenue);
  if (bonusRevenue != null) data.bonusRevenue = String(bonusRevenue);
  if (generalComment !== undefined) data.generalComment = generalComment || null;
  if (employeeName) data.employeeName = employeeName.trim();
  if (employeeId !== undefined) data.employeeId = employeeId ? Number(employeeId) : null;
  if (shiftType !== undefined) data.shiftType = shiftType || null;
  if (bookkeeperComment !== undefined) data.bookkeeperComment = bookkeeperComment || null;
  if (status) data.status = status;
  if (excludedFromReport !== undefined) data.excludedFromReport = excludedFromReport;

  // Если переданы строки расходов — пересохраняем их и пересчитываем сумму
  if (Array.isArray(expenseItems)) {
    const filled = expenseItems.filter((i: { amount: string }) => parseFloat(i.amount) > 0);

    data.additionalExpenses = filled
      .reduce((s: number, i: { amount: string }) => s + (parseFloat(i.amount) || 0), 0)
      .toFixed(2);

    data.expenseComment =
      filled.length > 0
        ? filled
            .map((i: { amount: string; comment?: string }) =>
              i.comment
                ? `${parseFloat(i.amount).toLocaleString('ru-RU')} — ${i.comment}`
                : parseFloat(i.amount).toLocaleString('ru-RU')
            )
            .join('; ')
        : null;

    const entry = await prisma.$transaction(async (tx) => {
      await tx.dailyExpenseItem.deleteMany({ where: { entryId: id } });

      if (filled.length > 0) {
        await tx.dailyExpenseItem.createMany({
          data: filled.map((i: { amount: string; category?: string; comment?: string }) => ({
            entryId: id,
            amount: i.amount,
            category: i.category || null,
            comment: i.comment || null,
          })),
        });
      }

      return tx.dailyRevenueEntry.update({
        where: { id },
        data,
        include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
      });
    });

    return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
  }

  // Если строки расходов не переданы — обновляем только скалярные поля
  const entry = await prisma.dailyRevenueEntry.update({
    where: { id },
    data,
    include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
  });

  return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
}
