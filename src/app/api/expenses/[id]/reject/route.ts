import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';
import { isMonthClosed } from '@/lib/closed-month';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const existing = await prisma.extractedExpenseEntry.findUnique({ where: { id }, select: { operationDate: true } });
  if (!existing) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  // Строка уже попала (или не попала) в замороженный снимок закрытого месяца — менять её
  // статус задним числом бессмысленно и вредно: снимок не изменится, а живые данные разойдутся
  // с ним (та же защита, что у записей выручки и табеля).
  if (await isMonthClosed(existing.operationDate)) {
    return NextResponse.json(
      { error: 'Месяц закрыт — отклонить расход нельзя. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { reviewerComment } = body;

  const entry = await prisma.extractedExpenseEntry.update({
    where: { id },
    data: {
      status: 'rejected',
      reviewerComment: reviewerComment || null,
    },
  });

  return NextResponse.json({ ...entry, amount: Number(entry.amount) });
}
