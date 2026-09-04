import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { hashPassword } from '@/lib/password';
import { USER_LINKED_TYPES } from '@/lib/employee-types';
import { findPharmacyUnlinkBlocker } from '@/lib/employee-pharmacy-validation';

function serialize(u: Record<string, unknown>) {
  const { passwordHash: _, ...rest } = u as { passwordHash: unknown } & Record<string, unknown>;
  return rest;
}

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
    fiveDayViaAttendance: false,
    allowance: Number(e.allowance),
    allowanceDescription: e.allowanceDescription,
    accountType: 'employee' as const,
  };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const { displayName, password, isActive, pharmacyIds, baseSalary, employeeType, ladderPremiumEnabled, managerBonusShareEnabled, fiveDayViaAttendance, allowance, allowanceDescription } =
    await request.json();

  if (employeeType != null && !USER_LINKED_TYPES.has(employeeType)) {
    return NextResponse.json({ error: 'Некорректный тип заведующего/менеджера' }, { status: 400 });
  }

  // Менеджер (pharmacy_manager) без логина — id отрицательный, ссылается на Employee.id.
  // Тип нельзя переключить на заведующего задним числом (появился бы логин "из ниоткуда") —
  // для такой смены роли нужно удалить и создать заново.
  if (id < 0) {
    const employeeId = -id;
    const existing = await prisma.employee.findFirst({ where: { id: employeeId, employeeType: 'pharmacy_manager', user: null } });
    if (!existing) {
      return NextResponse.json({ error: 'Менеджер не найден' }, { status: 404 });
    }
    if (employeeType != null && employeeType !== 'pharmacy_manager') {
      return NextResponse.json({ error: 'Нельзя сменить тип менеджера на заведующего — удалите и создайте заново' }, { status: 400 });
    }

    if (Array.isArray(pharmacyIds)) {
      const currentLinks = await prisma.employeePharmacy.findMany({ where: { employeeId }, select: { pharmacyId: true } });
      const newIds = new Set(pharmacyIds.map(Number));
      const removedPharmacyIds = currentLinks.map((l) => l.pharmacyId).filter((pid) => !newIds.has(pid));
      const blocker = await findPharmacyUnlinkBlocker(employeeId, removedPharmacyIds);
      if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
    }

    const employeeData: Record<string, unknown> = {};
    if (displayName !== undefined) employeeData.name = displayName.trim();
    if (isActive !== undefined) employeeData.isActive = isActive;
    if (baseSalary != null) employeeData.baseSalary = String(baseSalary);
    if (ladderPremiumEnabled !== undefined) employeeData.ladderPremiumEnabled = Boolean(ladderPremiumEnabled);
    if (managerBonusShareEnabled !== undefined) employeeData.managerBonusShareEnabled = Boolean(managerBonusShareEnabled);
    if (allowance !== undefined) employeeData.allowance = String(allowance ?? 0);
    if (allowanceDescription !== undefined) employeeData.allowanceDescription = typeof allowanceDescription === 'string' ? allowanceDescription.trim() : '';

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(employeeData).length > 0) {
        await tx.employee.update({ where: { id: employeeId }, data: employeeData });
      }
      if (Array.isArray(pharmacyIds)) {
        await tx.employeePharmacy.deleteMany({ where: { employeeId } });
        if (pharmacyIds.length > 0) {
          await tx.employeePharmacy.createMany({
            data: pharmacyIds.map((pid: number) => ({ employeeId, pharmacyId: pid })),
            skipDuplicates: true,
          });
        }
      }
      return tx.employee.findUnique({
        where: { id: employeeId },
        include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
      });
    });

    return NextResponse.json(serializeLoginlessManager(updated!));
  }

  // Заведующего нельзя переключить на менеджера через редактирование — у него уже есть
  // логин, а менеджер по определению не должен иметь доступа к системе
  if (employeeType === 'pharmacy_manager') {
    return NextResponse.json({ error: 'Нельзя сменить тип заведующего на менеджера — удалите и создайте заново' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (displayName !== undefined) data.displayName = displayName.trim();
  if (isActive !== undefined) data.isActive = isActive;
  if (password) {
    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 });
    }
    data.passwordHash = hashPassword(password);
  }

  if (Array.isArray(pharmacyIds)) {
    const existingUser = await prisma.user.findUnique({ where: { id }, select: { employeeId: true } });
    if (existingUser?.employeeId != null) {
      const currentLinks = await prisma.employeePharmacy.findMany({
        where: { employeeId: existingUser.employeeId },
        select: { pharmacyId: true },
      });
      const newIds = new Set(pharmacyIds.map(Number));
      const removedPharmacyIds = currentLinks.map((l) => l.pharmacyId).filter((pid) => !newIds.has(pid));
      const blocker = await findPharmacyUnlinkBlocker(existingUser.employeeId, removedPharmacyIds);
      if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id }, data });

    // Связанная карточка сотрудника (Employee) обновляется вместе с заведующим/менеджером
    if (updated.employeeId != null) {
      const employeeData: Record<string, unknown> = {};
      if (displayName !== undefined) employeeData.name = displayName.trim();
      if (baseSalary != null) employeeData.baseSalary = String(baseSalary);
      if (employeeType != null) employeeData.employeeType = employeeType;
      if (ladderPremiumEnabled !== undefined) employeeData.ladderPremiumEnabled = Boolean(ladderPremiumEnabled);
      if (managerBonusShareEnabled !== undefined) employeeData.managerBonusShareEnabled = Boolean(managerBonusShareEnabled);
      // Применимо только к manager_trading — форма отправляет это поле только для неё,
      // но если тип одновременно меняют на manager_fixed, значение всё равно безобидно
      // (FIVE_DAY_VIA_ATTENDANCE_TYPES для manager_fixed его не читает).
      if (fiveDayViaAttendance !== undefined) employeeData.fiveDayViaAttendance = Boolean(fiveDayViaAttendance);
      if (allowance !== undefined) employeeData.allowance = String(allowance ?? 0);
      if (allowanceDescription !== undefined) employeeData.allowanceDescription = typeof allowanceDescription === 'string' ? allowanceDescription.trim() : '';
      if (Object.keys(employeeData).length > 0) {
        await tx.employee.update({ where: { id: updated.employeeId }, data: employeeData });
      }
    }

    if (Array.isArray(pharmacyIds)) {
      await tx.userPharmacy.deleteMany({ where: { userId: id } });
      if (pharmacyIds.length > 0) {
        await tx.userPharmacy.createMany({
          data: pharmacyIds.map((pid: number) => ({ userId: id, pharmacyId: pid })),
          skipDuplicates: true,
        });
      }
      if (updated.employeeId != null) {
        await tx.employeePharmacy.deleteMany({ where: { employeeId: updated.employeeId } });
        if (pharmacyIds.length > 0) {
          await tx.employeePharmacy.createMany({
            data: pharmacyIds.map((pid: number) => ({ employeeId: updated.employeeId as number, pharmacyId: pid })),
            skipDuplicates: true,
          });
        }
      }
    }

    return tx.user.findUnique({
      where: { id: updated.id },
      include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
    });
  });

  return NextResponse.json({
    ...serialize(user as unknown as Record<string, unknown>),
    pharmacies: user!.pharmacies.map((p) => p.pharmacy),
    accountType: 'user' as const,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);

  // Менеджер (pharmacy_manager) без логина — id отрицательный, ссылается на Employee.id напрямую
  if (id < 0) {
    const employeeId = -id;
    const existing = await prisma.employee.findFirst({ where: { id: employeeId, employeeType: 'pharmacy_manager', user: null } });
    if (!existing) {
      return NextResponse.json({ error: 'Менеджер не найден' }, { status: 404 });
    }
    await prisma.employee.delete({ where: { id: employeeId } });
    return NextResponse.json({ ok: true });
  }

  // Удаление аккаунта заведующего/менеджера должно убирать и его привязанную
  // карточку сотрудника (Employee) — иначе она остаётся в системе как "невидимый"
  // дубликат, которого не видно на /users, но который всё ещё считается в зарплате.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, select: { employeeId: true } });
    if (user?.employeeId != null) {
      await tx.employee.delete({ where: { id: user.employeeId } });
    }
    await tx.user.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
