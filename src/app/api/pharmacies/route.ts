import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const pharmacies = await prisma.pharmacy.findMany({
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(pharmacies);
}

export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const { name, isActive } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Название обязательно' }, { status: 400 });
  }
  const pharmacy = await prisma.pharmacy.create({
    data: { name: name.trim(), isActive: isActive ?? true },
  });
  return NextResponse.json(pharmacy, { status: 201 });
}
