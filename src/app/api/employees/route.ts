import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAnyRole, getManagerPharmacyIds } from '@/lib/api-auth';
import { EMPLOYEE_TYPES } from '@/lib/employee-types';

function serialize(emp: Record<string, unknown>) {
  return {
    ...emp,
    baseSalary: Number(emp.baseSalary),
    shiftRate: emp.shiftRate != null ? Number(emp.shiftRate) : null,
    allowance: Number(emp.allowance ?? 0),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const isActiveParam = searchParams.get('isActive');
  const pharmacyIdParam = searchParams.get('pharmacyId');

  const allowedIds = await getManagerPharmacyIds(request);

  const where: Record<string, unknown> = {};
  if (isActiveParam === 'true') where.isActive = true;
  if (isActiveParam === 'false') where.isActive = false;

  // Для менеджера — показываем только сотрудников, привязанных к его аптекам
  if (allowedIds !== null) {
    if (pharmacyIdParam) {
      const pharmacyId = Number(pharmacyIdParam);
      if (!allowedIds.includes(pharmacyId)) {
        return NextResponse.json({ error: 'Аптека вне зоны ответственности' }, { status: 403 });
      }
      where.pharmacies = { some: { pharmacyId } };
    } else {
      where.pharmacies = { some: { pharmacyId: { in: allowedIds } } };
    }
  } else if (pharmacyIdParam) {
    // Admin/bookkeeper могут фильтровать по конкретной аптеке
    where.pharmacies = { some: { pharmacyId: Number(pharmacyIdParam) } };
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json(
    employees.map((e) => ({
      ...serialize(e as unknown as Record<string, unknown>),
      pharmacies: e.pharmacies.map((p) => p.pharmacy),
    }))
  );
}

export async function POST(request: NextRequest) {
  // Только admin/bookkeeper могут создавать сотрудников
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const { name, baseSalary, isActive, employeeType, shiftRate, allowance, allowanceDescription, fiveDayViaAttendance } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Имя сотрудника обязательно' }, { status: 400 });
  }
  if (employeeType != null && !(employeeType in EMPLOYEE_TYPES)) {
    return NextResponse.json({ error: 'Некорректный тип сотрудника' }, { status: 400 });
  }

  const employee = await prisma.employee.create({
    data: {
      name: name.trim(),
      baseSalary: String(baseSalary ?? 0),
      isActive: isActive !== false,
      employeeType: employeeType ?? 'seller',
      shiftRate: shiftRate != null ? String(shiftRate) : null,
      allowance: String(allowance ?? 0),
      allowanceDescription: typeof allowanceDescription === 'string' ? allowanceDescription.trim() : '',
      fiveDayViaAttendance: Boolean(fiveDayViaAttendance),
    },
  });

  return NextResponse.json(serialize(employee as unknown as Record<string, unknown>), { status: 201 });
}
