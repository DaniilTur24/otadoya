import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { hashPassword } from '@/lib/password';

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
  const { displayName, password, isActive, pharmacyIds } = await request.json();

  const data: Record<string, unknown> = {};
  if (displayName !== undefined) data.displayName = displayName.trim();
  if (isActive !== undefined) data.isActive = isActive;
  if (password) {
    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 });
    }
    data.passwordHash = hashPassword(password);
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id }, data });

    if (Array.isArray(pharmacyIds)) {
      await tx.userPharmacy.deleteMany({ where: { userId: id } });
      if (pharmacyIds.length > 0) {
        await tx.userPharmacy.createMany({
          data: pharmacyIds.map((pid: number) => ({ userId: id, pharmacyId: pid })),
          skipDuplicates: true,
        });
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
