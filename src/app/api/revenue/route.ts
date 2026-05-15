import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function serializeEntry(entry: Record<string, unknown>) {
  const items = (entry.expenseItems as { amount: unknown; comment: unknown }[] | undefined) ?? [];
  return {
    ...entry,
    cashRevenue: Number(entry.cashRevenue),
    terminalRevenue: Number(entry.terminalRevenue),
    bonusRevenue: Number(entry.bonusRevenue ?? 0),
    additionalExpenses: Number(entry.additionalExpenses),
    totalRevenue: Number(entry.cashRevenue) + Number(entry.terminalRevenue),
    expenseItems: items.map((i) => ({
      ...i,
      amount: Number(i.amount),
    })),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const pharmacyId = searchParams.get('pharmacyId');

  const where: Record<string, unknown> = {};
  if (status && status !== 'all') where.status = status;
  if (pharmacyId) where.pharmacyId = Number(pharmacyId);

  const entries = await prisma.dailyRevenueEntry.findMany({
    where,
    include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json(entries.map((e) => serializeEntry(e as unknown as Record<string, unknown>)));
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    pharmacyId,
    date,
    cashRevenue,
    terminalRevenue,
    bonusRevenue,
    expenseItems,   // [{ amount, comment }]
    generalComment,
    employeeName,
  } = body;

  if (!pharmacyId || !date || cashRevenue == null || terminalRevenue == null || !employeeName) {
    return NextResponse.json(
      { error: 'Обязательные поля: аптека, дата, выручка наличными, выручка по терминалу, имя сотрудника' },
      { status: 400 }
    );
  }

  // Считаем сумму расходов из переданных строк
  const items: { amount: string; comment?: string }[] =
    Array.isArray(expenseItems)
      ? expenseItems.filter((i) => parseFloat(i.amount) > 0)
      : [];

  const totalExpenses = items
    .reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0)
    .toFixed(2);

  // Краткий текст для быстрого просмотра: "1 000 — Канцтовары; 500 — Уборка"
  const expenseComment =
    items.length > 0
      ? items
          .map((i) =>
            i.comment
              ? `${parseFloat(i.amount).toLocaleString('ru-RU')} — ${i.comment}`
              : parseFloat(i.amount).toLocaleString('ru-RU')
          )
          .join('; ')
      : null;

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyRevenueEntry.create({
      data: {
        pharmacyId: Number(pharmacyId),
        date: new Date(date),
        cashRevenue: String(cashRevenue || 0),
        terminalRevenue: String(terminalRevenue || 0),
        bonusRevenue: String(bonusRevenue || 0),
        additionalExpenses: totalExpenses,
        expenseComment,
        generalComment: generalComment || null,
        employeeName: employeeName.trim(),
        status: 'approved',
      },
    });

    if (items.length > 0) {
      await tx.dailyExpenseItem.createMany({
        data: items.map((i) => ({
          entryId: created.id,
          amount: i.amount,
          comment: i.comment || null,
        })),
      });
    }

    return tx.dailyRevenueEntry.findUnique({
      where: { id: created.id },
      include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
    });
  });

  return NextResponse.json(
    serializeEntry(entry as unknown as Record<string, unknown>),
    { status: 201 }
  );
}
