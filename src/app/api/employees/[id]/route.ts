import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';
import { EMPLOYEE_TYPES, USER_LINKED_TYPES } from '@/lib/employee-types';

function serialize(emp: Record<string, unknown>) {
  return {
    ...emp,
    baseSalary: Number(emp.baseSalary),
    shiftRate: emp.shiftRate != null ? Number(emp.shiftRate) : null,
    allowance: Number(emp.allowance ?? 0),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
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
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const employeeId = Number((await params).id);
  const { name, baseSalary, isActive, employeeType, shiftRate, allowance, allowanceDescription, fiveDayViaAttendance } = await request.json();

  if (employeeType != null && !(employeeType in EMPLOYEE_TYPES)) {
    return NextResponse.json({ error: 'Некорректный тип сотрудника' }, { status: 400 });
  }

  // Заведующие/менеджеры (USER_LINKED_TYPES) привязаны к аккаунту User — имя/оклад/тип/доплата
  // редактируются только на /users, иначе карточка Employee расходится с привязанным аккаунтом.
  const current = await prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeType: true } });
  if (current && USER_LINKED_TYPES.has(current.employeeType)) {
    const blockedFields = { name, baseSalary, employeeType, allowance, allowanceDescription };
    const touched = Object.entries(blockedFields).filter(([, v]) => v !== undefined);
    if (touched.length > 0) {
      return NextResponse.json(
        { error: 'Этот сотрудник привязан к аккаунту заведующего/менеджера — имя, оклад, тип и доплату нужно менять на странице /users' },
        { status: 400 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (name != null) data.name = name.trim();
  if (baseSalary != null) data.baseSalary = String(baseSalary);
  if (isActive != null) data.isActive = Boolean(isActive);
  if (employeeType != null) data.employeeType = employeeType;
  if (shiftRate !== undefined) data.shiftRate = shiftRate != null ? String(shiftRate) : null;
  if (allowance !== undefined) data.allowance = String(allowance ?? 0);
  if (allowanceDescription !== undefined) data.allowanceDescription = typeof allowanceDescription === 'string' ? allowanceDescription.trim() : '';
  if (fiveDayViaAttendance !== undefined) data.fiveDayViaAttendance = Boolean(fiveDayViaAttendance);

  const employee = await prisma.employee.update({
    where: { id: employeeId },
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
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const employeeId = Number((await params).id);

  // Заведующие/менеджеры (USER_LINKED_TYPES) привязаны к аккаунту User — удаление
  // отсюда оставило бы аккаунт без карточки сотрудника. Удалять их нужно на /users,
  // где вместе с аккаунтом удаляется и эта карточка.
  const current = await prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeType: true } });
  if (current && USER_LINKED_TYPES.has(current.employeeType)) {
    return NextResponse.json(
      { error: 'Этот сотрудник привязан к аккаунту заведующего/менеджера — удалить его можно только на странице /users' },
      { status: 400 }
    );
  }

  await prisma.employee.delete({ where: { id: employeeId } });
  return NextResponse.json({ ok: true });
}
