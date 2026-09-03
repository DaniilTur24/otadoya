import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole } from '@/lib/api-auth';
import { canMarkAttendance } from '@/lib/employee-types';
import { isYearMonthClosed } from '@/lib/closed-month';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * PUT /api/attendance/bulk { employeeId, pharmacyId?, year, month, dates: string[] }
 * Реконсилирует отметки табеля сотрудника за месяц с переданным набором дат за один запрос —
 * без этого endpoint выделение диапазона в сетке табеля превращалось бы в десятки отдельных
 * POST/DELETE на каждый день.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { employeeId, pharmacyId, year, month, dates } = await request.json();

  if (!employeeId || !year || !month || !Array.isArray(dates)) {
    return NextResponse.json({ error: 'employeeId, year, month и dates обязательны' }, { status: 400 });
  }

  // Реконсиляция затрагивает весь месяц сразу (в том числе удаляет отметки) — в закрытом
  // месяце это переписало бы уже зафиксированную зарплату.
  if (await isYearMonthClosed(Number(year), Number(month))) {
    return NextResponse.json(
      { error: 'Месяц закрыт — изменить табель нельзя. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 }
    );
  }

  const employee = await prisma.employee.findUnique({ where: { id: Number(employeeId) } });
  if (!employee) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 });

  if (!canMarkAttendance(employee)) {
    return NextResponse.json(
      { error: 'Этому типу сотрудника нельзя отметить табель — он учитывается через смену в записи выручки' },
      { status: 400 }
    );
  }

  const role = getRequestRole(request);
  if (role === 'manager') {
    const allowedIds = await getManagerPharmacyIds(request);
    if (!pharmacyId || !allowedIds?.includes(Number(pharmacyId))) {
      return NextResponse.json({ error: 'Аптека вне зоны ответственности' }, { status: 403 });
    }
  }

  const monthStart = new Date(Number(year), Number(month) - 1, 1);
  const monthEnd = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

  const invalidDate = (dates as string[]).find((d) => {
    const parsed = new Date(d);
    return Number.isNaN(parsed.getTime()) || parsed < monthStart || parsed > monthEnd;
  });
  if (invalidDate) {
    return NextResponse.json({ error: `Дата ${invalidDate} вне выбранного месяца` }, { status: 400 });
  }

  const desired = new Set(dates as string[]);
  const pid = pharmacyId ? Number(pharmacyId) : null;

  const existing = await prisma.attendanceShift.findMany({
    where: { employeeId: Number(employeeId), date: { gte: monthStart, lte: monthEnd } },
  });
  const existingByKey = new Map(existing.map((s) => [dateKey(s.date), s]));

  const toDeleteIds = existing.filter((s) => !desired.has(dateKey(s.date))).map((s) => s.id);
  const toUpsert = [...desired].filter((d) => {
    const current = existingByKey.get(d);
    return !current || current.pharmacyId !== pid;
  });

  // seller_five_day_fixed может получать и смену в выручке, и отметку табеля, но не обе на одну
  // дату — проверяем только реально новые даты табеля (уже существующие переотмечать не мешает).
  const newDates = new Set([...desired].filter((d) => !existingByKey.has(d)));
  if (newDates.size > 0) {
    const monthShifts = await prisma.dailyRevenueEntry.findMany({
      where: {
        employeeId: Number(employeeId),
        shiftType: { not: null },
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { date: true },
    });
    const conflictingShift = monthShifts.find((s) => newDates.has(dateKey(s.date)));
    if (conflictingShift) {
      return NextResponse.json(
        { error: `На дату ${dateKey(conflictingShift.date)} у сотрудника уже назначена смена в записи выручки — нельзя также отметить табель` },
        { status: 409 }
      );
    }
  }

  await prisma.$transaction([
    ...(toDeleteIds.length > 0 ? [prisma.attendanceShift.deleteMany({ where: { id: { in: toDeleteIds } } })] : []),
    ...toUpsert.map((d) =>
      prisma.attendanceShift.upsert({
        where: { employeeId_date: { employeeId: Number(employeeId), date: new Date(d) } },
        update: { pharmacyId: pid },
        create: { employeeId: Number(employeeId), date: new Date(d), pharmacyId: pid },
      })
    ),
  ]);

  const shifts = await prisma.attendanceShift.findMany({
    where: { employeeId: Number(employeeId), date: { gte: monthStart, lte: monthEnd } },
    orderBy: { date: 'asc' },
  });

  return NextResponse.json(shifts.map((s) => ({ ...s, overtimeHours: Number(s.overtimeHours) })));
}
