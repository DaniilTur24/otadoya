import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole } from '@/lib/api-auth';
import { SHIFT_TYPES } from '@/lib/shift-types';

/**
 * Была ли у сотрудника суточная смена в предыдущий календарный день — форма выручки по этому
 * спрашивает, продолжение это той же смены или новая (см. isShiftContinuation).
 *
 * Намеренно без фильтра по аптекам заведующей: сотрудник может стоять на смене в аптеке, которой
 * она не управляет, и скрытая от неё вчерашняя смена привела бы ровно к тому задвоению оплаты,
 * ради которого эта проверка и существует.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const employeeId = Number(searchParams.get('employeeId'));
  const date = searchParams.get('date');
  if (!employeeId || !date) {
    return NextResponse.json({ error: 'Нужны employeeId и date' }, { status: 400 });
  }

  const target = new Date(date);
  if (Number.isNaN(target.getTime())) {
    return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 });
  }

  const prevStart = new Date(target.getFullYear(), target.getMonth(), target.getDate() - 1);
  const prevEnd = new Date(target.getFullYear(), target.getMonth(), target.getDate() - 1, 23, 59, 59, 999);

  const previous = await prisma.dailyRevenueEntry.findFirst({
    where: {
      employeeId,
      shiftType: SHIFT_TYPES.full_day,
      date: { gte: prevStart, lte: prevEnd },
    },
    select: { id: true, date: true, pharmacy: { select: { name: true } } },
  });

  return NextResponse.json({
    hasPreviousFullDay: previous !== null,
    previousDate: previous ? previous.date.toISOString() : null,
    previousPharmacyName: previous?.pharmacy.name ?? null,
  });
}
