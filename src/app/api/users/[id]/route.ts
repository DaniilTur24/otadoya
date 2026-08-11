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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const { displayName, password, isActive, pharmacyIds, baseSalary, employeeType, managerPremiumEnabled, ladderPremiumEnabled, allowance, allowanceDescription } =
    await request.json();

  const data: Record<string, unknown> = {};
  if (displayName !== undefined) data.displayName = displayName.trim();
  if (isActive !== undefined) data.isActive = isActive;
  if (password) {
    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 });
    }
    data.passwordHash = hashPassword(password);
  }
  if (employeeType != null && !USER_LINKED_TYPES.has(employeeType)) {
    return NextResponse.json({ error: 'Некорректный тип заведующего/менеджера' }, { status: 400 });
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
      if (managerPremiumEnabled !== undefined) employeeData.managerPremiumEnabled = Boolean(managerPremiumEnabled);
      if (ladderPremiumEnabled !== undefined) employeeData.ladderPremiumEnabled = Boolean(ladderPremiumEnabled);
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
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const id = Number((await params).id);
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
