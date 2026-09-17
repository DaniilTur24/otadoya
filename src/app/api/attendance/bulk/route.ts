import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole } from '@/lib/api-auth';
import { canMarkAttendance } from '@/lib/employee-types';
import { isYearMonthClosed } from '@/lib/closed-month';
import { validateNotFutureDate, validateEmployeePharmacyLink, validateWithinWorkingCalendar } from '@/lib/attendance-validation';

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

  // Сотрудник должен реально работать в этой аптеке — та же проверка, что и в одиночном
  // POST /api/attendance (офисные отметки без аптеки проверке не подлежат).
  if (pharmacyId) {
    const pharmacyLinkError = await validateEmployeePharmacyLink(Number(employeeId), Number(pharmacyId));
    if (pharmacyLinkError) {
      return NextResponse.json({ error: pharmacyLinkError }, { status: 400 });
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

  // Реконсиляция — только в рамках аптеки этой строки табеля (pid). Раньше сверялся весь месяц
  // сотрудника целиком: заведующая видит отметки только своих аптек, поэтому её «полный список»
  // не содержал отметок, поставленных в другой аптеке, и сервер их удалял; а у админа отметки
  // другой аптеки молча переназначались на pid через upsert. Сотрудник, работающий в двух
  // аптеках (уборщица), терял смены без следа (QA раунд 4, №4). Теперь: отметки других аптек
  // не трогаем, а дату, уже занятую в другой аптеке, не переназначаем, а сообщаем.
  const allExisting = await prisma.attendanceShift.findMany({
    where: { employeeId: Number(employeeId), date: { gte: monthStart, lte: monthEnd } },
    include: { pharmacy: { select: { name: true } } },
  });
  const existing = allExisting.filter((s) => s.pharmacyId === pid);
  const existingByKey = new Map(existing.map((s) => [dateKey(s.date), s]));
  const otherPharmacyByKey = new Map(allExisting.filter((s) => s.pharmacyId !== pid).map((s) => [dateKey(s.date), s]));

  const toDeleteIds = existing.filter((s) => !desired.has(dateKey(s.date))).map((s) => s.id);
  const toCreate = [...desired].filter((d) => !existingByKey.has(d));

  const conflict = toCreate.find((d) => otherPharmacyByKey.has(d));
  if (conflict) {
    const other = otherPharmacyByKey.get(conflict)!;
    const where = other.pharmacy?.name ? `в аптеке «${other.pharmacy.name}»` : 'без аптеки (офис)';
    return NextResponse.json(
      { error: `На дату ${conflict} у сотрудника уже есть отметка табеля ${where} — сначала снимите её там` },
      { status: 409 }
    );
  }

  // seller_five_day_fixed может получать и смену в выручке, и отметку табеля, но не обе на одну
  // дату — проверяем только реально новые даты табеля (уже существующие переотмечать не мешает).
  const newDates = new Set(toCreate);

  // Запрет будущих дат — только для реально новых отметок (снять уже существующую отметку или
  // переназначить её аптеку можно в любом случае, это не создаёт новый табель наперёд).
  for (const d of newDates) {
    const futureDateError = validateNotFutureDate(new Date(d));
    if (futureDateError) {
      return NextResponse.json({ error: `${d}: ${futureDateError}` }, { status: 400 });
    }
  }

  if (newDates.size > 0) {
    const monthShifts = await prisma.dailyRevenueEntry.findMany({
      where: {
        employeeId: Number(employeeId),
        shiftType: { not: null },
        status: { not: 'rejected' },
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

  // Норма считается после снятия: снял 3 дня и отметил 3 других — итог тот же, нарушения нет.
  const netNewMarks = newDates.size - toDeleteIds.length;
  const overCalendarError = await validateWithinWorkingCalendar(employee, Number(year), Number(month), netNewMarks);
  if (overCalendarError) {
    return NextResponse.json({ error: overCalendarError }, { status: 409 });
  }

  await prisma.$transaction([
    ...(toDeleteIds.length > 0 ? [prisma.attendanceShift.deleteMany({ where: { id: { in: toDeleteIds } } })] : []),
    ...(toCreate.length > 0
      ? [
          prisma.attendanceShift.createMany({
            data: toCreate.map((d) => ({ employeeId: Number(employeeId), date: new Date(d), pharmacyId: pid })),
          }),
        ]
      : []),
  ]);

  const shifts = await prisma.attendanceShift.findMany({
    where: { employeeId: Number(employeeId), date: { gte: monthStart, lte: monthEnd } },
    orderBy: { date: 'asc' },
  });

  return NextResponse.json(shifts.map((s) => ({ ...s, overtimeHours: Number(s.overtimeHours) })));
}
