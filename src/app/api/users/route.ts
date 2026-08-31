import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { hashPassword } from '@/lib/password';
import { USER_LINKED_TYPES } from '@/lib/employee-types';

function serialize(u: Record<string, unknown>) {
  const { passwordHash: _, ...rest } = u as { passwordHash: unknown } & Record<string, unknown>;
  return rest;
}

// Менеджер (pharmacy_manager) не получает логин в систему — у него нет строки в User,
// только карточка Employee. Чтобы не путать её id с id обычного User (независимые
// последовательности могут совпасть), такие записи отдаются с отрицательным id.
function serializeLoginlessManager(e: {
  id: number; name: string; isActive: boolean; baseSalary: unknown; employeeType: string;
  ladderPremiumEnabled: boolean; managerBonusShareEnabled: boolean; allowance: unknown; allowanceDescription: string;
  pharmacies: { pharmacy: { id: number; name: string } }[];
}) {
  return {
    id: -e.id,
    username: '',
    displayName: e.name,
    isActive: e.isActive,
    pharmacies: e.pharmacies.map((p) => p.pharmacy),
    baseSalary: Number(e.baseSalary),
    employeeType: e.employeeType,
    ladderPremiumEnabled: e.ladderPremiumEnabled,
    managerBonusShareEnabled: e.managerBonusShareEnabled,
    allowance: Number(e.allowance),
    allowanceDescription: e.allowanceDescription,
    accountType: 'employee' as const,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const [users, loginlessManagers] = await Promise.all([
    prisma.user.findMany({
      include: {
        pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } },
        employee: { select: { baseSalary: true, employeeType: true, ladderPremiumEnabled: true, managerBonusShareEnabled: true, allowance: true, allowanceDescription: true } },
      },
    }),
    prisma.employee.findMany({
      where: { employeeType: 'pharmacy_manager', user: null },
      include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
    }),
  ]);

  const withLogin = users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isActive: u.isActive,
    pharmacies: u.pharmacies.map((p) => p.pharmacy),
    baseSalary: u.employee ? Number(u.employee.baseSalary) : 0,
    employeeType: u.employee?.employeeType ?? 'manager_trading',
    ladderPremiumEnabled: u.employee?.ladderPremiumEnabled ?? false,
    managerBonusShareEnabled: u.employee?.managerBonusShareEnabled ?? false,
    allowance: u.employee ? Number(u.employee.allowance) : 0,
    allowanceDescription: u.employee?.allowanceDescription ?? '',
    accountType: 'user' as const,
  }));

  const withoutLogin = loginlessManagers.map(serializeLoginlessManager);

  const all = [...withLogin, ...withoutLogin].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'ru')
  );

  return NextResponse.json(all);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { username, password, displayName, pharmacyIds, baseSalary, employeeType, ladderPremiumEnabled, managerBonusShareEnabled, allowance, allowanceDescription } =
    await request.json();

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'Обязательное поле: displayName' }, { status: 400 });
  }
  const resolvedEmployeeType = employeeType ?? 'manager_trading';
  if (!USER_LINKED_TYPES.has(resolvedEmployeeType)) {
    return NextResponse.json({ error: 'Некорректный тип заведующего/менеджера' }, { status: 400 });
  }

  // Менеджер (pharmacy_manager) не получает доступ к системе — создаём только карточку
  // сотрудника, без логина и пароля
  if (resolvedEmployeeType === 'pharmacy_manager') {
    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          name: displayName.trim(),
          baseSalary: String(baseSalary ?? 0),
          employeeType: resolvedEmployeeType,
          ladderPremiumEnabled: Boolean(ladderPremiumEnabled),
          managerBonusShareEnabled: Boolean(managerBonusShareEnabled),
          allowance: String(allowance ?? 0),
          allowanceDescription: typeof allowanceDescription === 'string' ? allowanceDescription.trim() : '',
        },
      });

      if (Array.isArray(pharmacyIds) && pharmacyIds.length > 0) {
        await tx.employeePharmacy.createMany({
          data: pharmacyIds.map((pid: number) => ({ employeeId: created.id, pharmacyId: pid })),
          skipDuplicates: true,
        });
      }

      return tx.employee.findUnique({
        where: { id: created.id },
        include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
      });
    });

    return NextResponse.json(serializeLoginlessManager(employee!), { status: 201 });
  }

  if (!username?.trim() || !password) {
    return NextResponse.json({ error: 'Обязательные поля: username, password' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 });
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
        ladderPremiumEnabled: Boolean(ladderPremiumEnabled),
        managerBonusShareEnabled: Boolean(managerBonusShareEnabled),
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
      accountType: 'user' as const,
    },
    { status: 201 }
  );
}
