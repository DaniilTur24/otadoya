import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { hashPassword } from '@/lib/password';
import { USER_LINKED_TYPES } from '@/lib/employee-types';

function serialize(u: Record<string, unknown>) {
  const { passwordHash: _, ...rest } = u as { passwordHash: unknown } & Record<string, unknown>;
  return rest;
}

export async function GET(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const users = await prisma.user.findMany({
    orderBy: { displayName: 'asc' },
    include: {
      pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } },
      employee: { select: { baseSalary: true, employeeType: true, managerPremiumEnabled: true, allowance: true, allowanceDescription: true } },
    },
  });

  return NextResponse.json(
    users.map((u) => ({
      ...serialize(u as unknown as Record<string, unknown>),
      pharmacies: u.pharmacies.map((p) => p.pharmacy),
      baseSalary: u.employee ? Number(u.employee.baseSalary) : 0,
      employeeType: u.employee?.employeeType ?? 'manager_trading',
      managerPremiumEnabled: u.employee?.managerPremiumEnabled ?? false,
      allowance: u.employee ? Number(u.employee.allowance) : 0,
      allowanceDescription: u.employee?.allowanceDescription ?? '',
    }))
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { username, password, displayName, pharmacyIds, baseSalary, employeeType, managerPremiumEnabled, allowance, allowanceDescription } =
    await request.json();

  if (!username?.trim() || !password || !displayName?.trim()) {
    return NextResponse.json(
      { error: 'Обязательные поля: username, password, displayName' },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 });
  }
  const resolvedEmployeeType = employeeType ?? 'manager_trading';
  if (!USER_LINKED_TYPES.has(resolvedEmployeeType)) {
    return NextResponse.json({ error: 'Некорректный тип заведующего/менеджера' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) {
    return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
  }

  const user = await prisma.$transaction(async (tx) => {
    // Заведующая всегда заводится и как сотрудник, чтобы не создавать её отдельно на /employees
    const employee = await tx.employee.create({
      data: {
        name: displayName.trim(),
        baseSalary: String(baseSalary ?? 0),
        employeeType: resolvedEmployeeType,
        managerPremiumEnabled: resolvedEmployeeType === 'pharmacy_manager' ? Boolean(managerPremiumEnabled) : false,
        allowance: String(allowance ?? 0),
        allowanceDescription: typeof allowanceDescription === 'string' ? allowanceDescription.trim() : '',
      },
    });

    const created = await tx.user.create({
      data: {
        username: username.trim(),
        passwordHash: hashPassword(password),
        displayName: displayName.trim(),
        role: 'manager',
        employeeId: employee.id,
      },
    });

    if (Array.isArray(pharmacyIds) && pharmacyIds.length > 0) {
      await tx.userPharmacy.createMany({
        data: pharmacyIds.map((pid: number) => ({ userId: created.id, pharmacyId: pid })),
        skipDuplicates: true,
      });
      await tx.employeePharmacy.createMany({
        data: pharmacyIds.map((pid: number) => ({ employeeId: employee.id, pharmacyId: pid })),
        skipDuplicates: true,
      });
    }

    return tx.user.findUnique({
      where: { id: created.id },
      include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
    });
  });

  return NextResponse.json(
    {
      ...serialize(user as unknown as Record<string, unknown>),
      pharmacies: user!.pharmacies.map((p) => p.pharmacy),
    },
    { status: 201 }
  );
}
