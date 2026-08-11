import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** GET /api/working-calendar?year=2025 — возвращает все записи за год (до 12 штук) */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const year = Number(new URL(request.url).searchParams.get('year') || new Date().getFullYear());
  if (!year || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Некорректный год' }, { status: 400 });
  }

  const entries = await prisma.workingCalendar.findMany({
    where: { year },
    select: { month: true, workingDays: true },
    orderBy: { month: 'asc' },
  });

  return NextResponse.json(entries);
}

/** PUT /api/working-calendar — создаёт или обновляет рабочие дни для месяца */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const body = await request.json();
  const year = Number(body.year);
  const month = Number(body.month);
  const workingDays = Number(body.workingDays);

  if (!year || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Некорректный год' }, { status: 400 });
  }
  if (!month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Некорректный месяц' }, { status: 400 });
  }
  if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) {
    return NextResponse.json({ error: 'Рабочих дней должно быть от 1 до 31' }, { status: 400 });
  }

  const entry = await prisma.workingCalendar.upsert({
    where: { year_month: { year, month } },
    update: { workingDays },
    create: { year, month, workingDays },
  });

  return NextResponse.json({ month: entry.month, workingDays: entry.workingDays });
}
