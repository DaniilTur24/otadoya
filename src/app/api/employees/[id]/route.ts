import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';
import { EMPLOYEE_TYPES } from '@/lib/employee-types';

function serialize(emp: Record<string, unknown>) {
  return {
    ...emp,
    baseSalary: Number(emp.baseSalary),
    shiftRate: emp.shiftRate != null ? Number(emp.shiftRate) : null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const employee = await prisma.employee.findUnique({
    where: { id: Number((await params).id) },
    include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
  });
  if (!employee) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
  return NextResponse.json({
    ...serialize(employee as unknown as Record<string, unknown>),
    pharmacies: employee.pharmacies.map((p) => p.pharmacy),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const { name, baseSalary, isActive, employeeType, shiftRate } = await request.json();

  if (employeeType != null && !(employeeType in EMPLOYEE_TYPES)) {
    return NextResponse.json({ error: 'Некорректный тип сотрудника' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (name != null) data.name = name.trim();
  if (baseSalary != null) data.baseSalary = String(baseSalary);
  if (isActive != null) data.isActive = Boolean(isActive);
  if (employeeType != null) data.employeeType = employeeType;
  if (shiftRate !== undefined) data.shiftRate = shiftRate != null ? String(shiftRate) : null;

  const employee = await prisma.employee.update({
    where: { id: Number((await params).id) },
    data,
    include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
  });

  return NextResponse.json({
    ...serialize(employee as unknown as Record<string, unknown>),
    pharmacies: employee.pharmacies.map((p) => p.pharmacy),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  await prisma.employee.delete({ where: { id: Number((await params).id) } });
  return NextResponse.json({ ok: true });
}
