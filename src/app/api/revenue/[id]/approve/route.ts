import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper, getRequestUserId } from '@/lib/api-auth';
import { isMonthClosed } from '@/lib/closed-month';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const existing = await prisma.dailyRevenueEntry.findUnique({ where: { id }, select: { date: true } });
  if (!existing) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  // Подтверждение — это включение записи в выручку, отчёт и зарплату. Для закрытого месяца эти
  // суммы уже заморожены снимком: подтверждённая «внутри» закрытого периода запись в него никогда
  // не попала бы, а бухгалтер видел бы зелёный статус и думал, что всё учтено (QA раунд 4, №6).
  if (await isMonthClosed(existing.date)) {
    return NextResponse.json(
      { error: 'Месяц закрыт — подтвердить запись нельзя. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { bookkeeperComment } = body;
  const approvedById = getRequestUserId(request);

  try {
    const entry = await prisma.dailyRevenueEntry.update({
      where: { id },
      data: {
        status: 'approved',
        bookkeeperComment: bookkeeperComment || null,
        approvedAt: new Date(),
        ...(approvedById ? { approvedById } : {}),
      },
    });
    return NextResponse.json(entry);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });
    }
    throw err;
  }
}
