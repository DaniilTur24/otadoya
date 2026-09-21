import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';
import { isMonthClosed } from '@/lib/closed-month';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);
// Только две категории имеют смысл для отчёта: rent → rentExpenses, expense → bankServices
// (см. computeMonthlyData). Любая другая строка молча выпадала бы из отчёта.
const VALID_CATEGORIES = new Set(['rent', 'expense']);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const existing = await prisma.extractedExpenseEntry.findUnique({ where: { id }, select: { operationDate: true } });
  if (!existing) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  // Раньше здесь принимались любые status/category/amount и без проверки закрытого месяца —
  // подтверждённый расход закрытого месяца можно было переписать задним числом (QA раунд 4, №12).
  if (await isMonthClosed(existing.operationDate)) {
    return NextResponse.json(
      { error: 'Месяц закрыт — изменить расход нельзя. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 }
    );
  }

  const body = await request.json();
  const { category, pharmacyId, reviewerComment, status, amount } = body;

  if (status != null && !VALID_STATUSES.has(String(status))) {
    return NextResponse.json({ error: `Некорректный статус: ${status}` }, { status: 400 });
  }
  if (category != null && !VALID_CATEGORIES.has(String(category))) {
    return NextResponse.json({ error: 'Категория: rent или expense' }, { status: 400 });
  }
  if (amount != null && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) {
    return NextResponse.json({ error: 'Сумма должна быть неотрицательным числом' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (category) data.category = category;
  if (pharmacyId !== undefined) data.pharmacyId = pharmacyId ? Number(pharmacyId) : null;
  if (reviewerComment !== undefined) data.reviewerComment = reviewerComment || null;
  if (status) data.status = status;
  if (amount != null) data.amount = String(amount);

  const entry = await prisma.extractedExpenseEntry.update({
    where: { id },
    data,
    include: { pharmacy: true },
  });

  return NextResponse.json({ ...entry, amount: Number(entry.amount) });
}
