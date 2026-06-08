import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';
import { hashPassword } from '@/lib/password';

function serialize(u: Record<string, unknown>) {
  const { passwordHash: _, ...rest } = u as { passwordHash: unknown } & Record<string, unknown>;
  return rest;
}

export async function GET(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const users = await prisma.user.findMany({
    orderBy: { displayName: 'asc' },
    include: { pharmacies: { include: { pharmacy: { select: { id: true, name: true } } } } },
  });

  return NextResponse.json(
    users.map((u) => ({
      ...serialize(u as unknown as Record<string, unknown>),
      pharmacies: u.pharmacies.map((p) => p.pharmacy),
    }))
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const { username, password, displayName, pharmacyIds } = await request.json();

  if (!username?.trim() || !password || !displayName?.trim()) {
    return NextResponse.json(
      { error: 'Обязательные поля: username, password, displayName' },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) {
    return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        username: username.trim(),
        passwordHash: hashPassword(password),
        displayName: displayName.trim(),
        role: 'manager',
      },
    });

    if (Array.isArray(pharmacyIds) && pharmacyIds.length > 0) {
      await tx.userPharmacy.createMany({
        data: pharmacyIds.map((pid: number) => ({ userId: created.id, pharmacyId: pid })),
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
