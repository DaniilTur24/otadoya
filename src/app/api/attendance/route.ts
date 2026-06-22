import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET /api/attendance?employeeId=&date=&month=&year=&pharmacyId=
// Возвращает отметки табеля посещаемости (manager_fixed / cleaner / office).
export async function GET(request: NextRequest) {
  const auth = requireAnyRole(request);
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

  return NextResponse.json(shifts);
}

// POST /api/attendance { employeeId, date, pharmacyId? }
// Отмечает одну отработанную смену сотрудника на дату (manager_fixed / cleaner / office).
export async function POST(request: NextRequest) {
  const auth = requireAnyRole(request);
  if (auth) return auth;

  const { employeeId, date, pharmacyId } = await request.json();
  if (!employeeId || !date) {
    return NextResponse.json({ error: 'employeeId и date обязательны' }, { status: 400 });
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

  try {
    const shift = await prisma.attendanceShift.create({
      data: {
        employeeId: Number(employeeId),
        date: new Date(date),
        pharmacyId: pharmacyId ? Number(pharmacyId) : null,
      },
    });
    return NextResponse.json(shift, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Смена за эту дату уже отмечена' }, { status: 409 });
  }
}
