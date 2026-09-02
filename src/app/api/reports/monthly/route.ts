import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeMonthlyData } from '@/lib/monthly-report-builder';
import { parseSnapshot } from '@/lib/salary-snapshot';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const year  = Number(searchParams.get('year')  || new Date().getFullYear());
  const month = Number(searchParams.get('month') || new Date().getMonth() + 1);

  const closed = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
  if (closed) {
    // Снимок теперь хранит и разбивку по сотрудникам (см. salary-snapshot.ts); отчёту нужна
    // только часть по аптекам, а parseSnapshot умеет читать и старый формат без обёртки.
    const { pharmacies: snapshotData } = parseSnapshot(closed.snapshotJson);
    const pharmacies = await prisma.pharmacy.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json({ pharmacies, isClosed: true, closedAt: closed.closedAt, snapshotData, overrideMap: {} });
  }

  const { pharmacies, systemData, overrideMap } = await computeMonthlyData(year, month);
  return NextResponse.json({ pharmacies, systemData, overrideMap, isClosed: false });
}

// PUT — сохранить или удалить override для одной ячейки
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const { year, month, pharmacyId, fieldKey, value } = await request.json();

  const closed = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
  if (closed) {
    return NextResponse.json({ error: 'Месяц закрыт — изменения невозможны' }, { status: 423 });
  }

  if (value === null || value === undefined) {
    await prisma.monthlyReportOverride.deleteMany({
      where: { year, month, pharmacyId: Number(pharmacyId), fieldKey },
    });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const override = await prisma.monthlyReportOverride.upsert({
    where: { year_month_pharmacyId_fieldKey: {
      year, month, pharmacyId: Number(pharmacyId), fieldKey,
    }},
    update: { value: String(value) },
    create: { year, month, pharmacyId: Number(pharmacyId), fieldKey, value: String(value) },
  });

  return NextResponse.json({ ok: true, value: Number(override.value) });
}
