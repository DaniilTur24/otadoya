import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeMonthlyData, buildMonthlySnapshot } from '@/lib/monthly-report-builder';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET — проверить закрыт ли месяц
export async function GET(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  if (!year || !month) return NextResponse.json({ isClosed: false });

  const record = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
  return NextResponse.json({ isClosed: !!record, closedAt: record?.closedAt ?? null });
}

// POST — закрыть месяц: снапшот строится на сервере из актуальных данных БД
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const { year, month } = await request.json();

  if (!year || !month) {
    return NextResponse.json({ error: 'year и month обязательны' }, { status: 400 });
  }

  const existing = await prisma.closedMonth.findUnique({
    where: { year_month: { year, month } },
  });
  if (existing) {
    return NextResponse.json({ error: 'Месяц уже закрыт' }, { status: 409 });
  }

  const { pharmacies, systemData, overrideMap } = await computeMonthlyData(year, month);
  const snapshot = buildMonthlySnapshot(pharmacies, systemData, overrideMap);

  const record = await prisma.closedMonth.create({
    data: { year, month, snapshotJson: JSON.stringify(snapshot) },
  });

  return NextResponse.json({ ok: true, closedAt: record.closedAt });
}

// DELETE — открыть месяц обратно
export async function DELETE(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const { year, month } = await request.json();

  await prisma.closedMonth.deleteMany({ where: { year, month } });

  return NextResponse.json({ ok: true });
}
