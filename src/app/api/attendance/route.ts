import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole } from '@/lib/api-auth';
import { canMarkAttendance } from '@/lib/employee-types';
import { isMonthClosed } from '@/lib/closed-month';
import { validateNoShiftOnDate } from '@/lib/attendance-validation';

export const dynamic = 'force-dynamic';

// GET /api/attendance?employeeId=&date=&month=&year=&pharmacyId=
// Возвращает отметки табеля посещаемости (manager_fixed / cleaner / office).
export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get('employeeId') ? Number(searchParams.get('employeeId')) : undefined;
  const date = searchParams.get('date');
  const month = searchParams.get('month') ? Number(searchParams.get('month')) : undefined;
  const year = searchParams.get('year') ? Number(searchParams.get('year')) : undefined;
  const pharmacyId = searchParams.get('pharmacyId') ? Number(searchParams.get('pharmacyId')) : undefined;

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (pharmacyId) where.pharmacyId = pharmacyId;

  if (date) {
    const d = new Date(date);
    where.date = {
      gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      lte: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
    };
  } else if (month && year) {
    where.date = { gte: new Date(year, month - 1, 1), lte: new Date(year, month, 0, 23, 59, 59, 999) };
  }

  const allowedIds = await getManagerPharmacyIds(request);
  if (allowedIds !== null) {
    // Заведующий видит только отметки своих аптек (офисные отметки без аптеки — недоступны)
    where.pharmacyId = pharmacyId ? (allowedIds.includes(pharmacyId) ? pharmacyId : -1) : { in: allowedIds };
  }

  const shifts = await prisma.attendanceShift.findMany({
    where,
    include: {
      employee: { select: { id: true, name: true, employeeType: true } },
      pharmacy: { select: { id: true, name: true } },
    },
    orderBy: { date: 'asc' },
  });

  return NextResponse.json(shifts.map((s) => ({ ...s, overtimeHours: Number(s.overtimeHours) })));
}

// POST /api/attendance { employeeId, date, pharmacyId?, overtimeHours? }
// Отмечает одну отработанную смену сотрудника на дату (manager_fixed / cleaner / office).
export async function POST(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { employeeId, date, pharmacyId, overtimeHours } = await request.json();
  if (!employeeId || !date) {
    return NextResponse.json({ error: 'employeeId и date обязательны' }, { status: 400 });
  }

  // Отметка табеля — это отработанный день, из которого считается зарплата. В закрытом
  // месяце суммы уже зафиксированы, поэтому новая отметка туда попасть не должна:
  // она разошлась бы со снимком (та же защита, что и у записи выручки).
  if (await isMonthClosed(new Date(date))) {
    return NextResponse.json(
      { error: 'Месяц закрыт — отметить смену нельзя. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 }
    );
  }

  const role = getRequestRole(request);
  if (role === 'manager') {
    const allowedIds = await getManagerPharmacyIds(request);
    if (!pharmacyId || !allowedIds?.includes(Number(pharmacyId))) {
      return NextResponse.json({ error: 'Аптека вне зоны ответственности' }, { status: 403 });
    }
  }

  const employee = await prisma.employee.findUnique({ where: { id: Number(employeeId) } });
  if (!employee) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 });

  // Сменные типы (seller/manager_trading) учитываются через смену в записи выручки, а не через
  // табель — их зарплата не читает AttendanceShift, отметка здесь была бы мёртвой и вводящей в заблуждение.
  // Исключения — продавец с включённым fiveDayViaAttendance и seller_five_day_fixed: см. canMarkAttendance.
  if (!canMarkAttendance(employee)) {
    return NextResponse.json(
      { error: 'Этому типу сотрудника нельзя отметить табель — он учитывается через смену в записи выручки' },
      { status: 400 }
    );
  }

  // seller_five_day_fixed может получать и смену в выручке, и отметку табеля, но не обе на одну
  // дату — иначе оплата за этот день задвоится.
  const shiftConflictError = await validateNoShiftOnDate(Number(employeeId), new Date(date));
  if (shiftConflictError) {
    return NextResponse.json({ error: shiftConflictError }, { status: 409 });
  }

  try {
    const shift = await prisma.attendanceShift.create({
      data: {
        employeeId: Number(employeeId),
        date: new Date(date),
        pharmacyId: pharmacyId ? Number(pharmacyId) : null,
        overtimeHours: overtimeHours ? Number(overtimeHours) : 0,
      },
    });
    return NextResponse.json({ ...shift, overtimeHours: Number(shift.overtimeHours) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Смена за эту дату уже отмечена' }, { status: 409 });
  }
}
