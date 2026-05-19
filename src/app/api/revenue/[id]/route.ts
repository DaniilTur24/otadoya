import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function serialize(entry: Record<string, unknown>) {
  const items = (entry.expenseItems as { amount: unknown; comment: unknown }[] | undefined) ?? [];
  return {
    ...entry,
    cashRevenue: Number(entry.cashRevenue),
    terminalRevenue: Number(entry.terminalRevenue),
    bonusRevenue: Number(entry.bonusRevenue ?? 0),
    additionalExpenses: Number(entry.additionalExpenses),
    totalRevenue: Number(entry.cashRevenue) + Number(entry.terminalRevenue),
    expenseItems: items.map((i) => ({ ...i, amount: Number(i.amount) })),
  };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.dailyRevenueEntry.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ ok: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const entry = await prisma.dailyRevenueEntry.findUnique({
    where: { id: Number(params.id) },
    include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
  });
  if (!entry) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
  return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const {
    pharmacyId, date, cashRevenue, terminalRevenue, kaspiRevenue, bonusRevenue,
    expenseItems, generalComment, employeeName, employeeId, shiftType,
    bookkeeperComment, status,
  } = body;

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
      await tx.dailyExpenseItem.deleteMany({ where: { entryId: Number(params.id) } });

      if (filled.length > 0) {
        await tx.dailyExpenseItem.createMany({
          data: filled.map((i: { amount: string; category?: string; comment?: string }) => ({
            entryId: Number(params.id),
            amount: i.amount,
            category: i.category || null,
            comment: i.comment || null,
          })),
        });
      }

      return tx.dailyRevenueEntry.update({
        where: { id: Number(params.id) },
        data,
        include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
      });
    });

    return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
  }

  // Если строки расходов не переданы — обновляем только скалярные поля
  const entry = await prisma.dailyRevenueEntry.update({
    where: { id: Number(params.id) },
    data,
    include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
  });

  return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
}
