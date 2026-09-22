import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { loadCashBalance } from '@/lib/cash-balance-query';
import { isMonthClosed } from '@/lib/closed-month';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const pharmacyId = Number(searchParams.get('pharmacyId'));
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  if (!pharmacyId) {
    return NextResponse.json({ error: 'Нужно выбрать аптеку' }, { status: 400 });
  }

  const balance = await loadCashBalance(pharmacyId, from, to);
  if (!balance) {
    return NextResponse.json({ configured: false, openingBalance: 0, days: [] });
  }

  const comments = Object.fromEntries(
    balance.movementRows.filter((m) => m.comment).map((m) => [m.date.toISOString().slice(0, 10), m.comment])
  );

  return NextResponse.json({
    configured: true,
    openingDate: balance.openingDate,
    openingBalance: balance.openingBalance,
    days: balance.days,
    comments,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { pharmacyId, date, amount, comment } = await request.json();

  if (!pharmacyId || !date) {
    return NextResponse.json({ error: 'Нужны аптека и дата' }, { status: 400 });
  }

  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return NextResponse.json({ error: 'Сумма указана неверно' }, { status: 400 });
  }
  if (value < 0) {
    return NextResponse.json({ error: 'Взнос в банк не может быть отрицательным' }, { status: 400 });
  }

  const day = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);

  // Взнос в банк меняет остаток кассы, который переносится изо дня в день и из месяца в месяц —
  // правка внутри уже закрытого месяца задним числом сдвинула бы «Сальдо» во всех последующих
  // месяцах, хотя закрытие обещает, что цифры за период зафиксированы (QA раунд 5, №7).
  if (await isMonthClosed(day)) {
    return NextResponse.json(
      { error: 'Месяц закрыт — изменить взнос в банк нельзя. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 },
    );
  }

  // Ноль — это «взноса не было», а не взнос на ноль: запись убирается целиком,
  // чтобы в истории не оставалось пустых строк.
  if (value === 0) {
    await prisma.cashMovement.deleteMany({ where: { pharmacyId: Number(pharmacyId), date: day } });
    return NextResponse.json({ ok: true, removed: true });
  }

  const movement = await prisma.cashMovement.upsert({
    where: { pharmacyId_date: { pharmacyId: Number(pharmacyId), date: day } },
    create: {
      pharmacyId: Number(pharmacyId),
      date: day,
      amount: String(value),
      comment: comment ? String(comment).trim() : null,
    },
    update: {
      amount: String(value),
      comment: comment ? String(comment).trim() : null,
    },
  });

  return NextResponse.json({ ok: true, id: movement.id });
}
