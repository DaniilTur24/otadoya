import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const body = await request.json();

  const alias = await prisma.pharmacyAlias.update({
    where: { id },
    data: {
      pharmacyId: body.pharmacyId ? Number(body.pharmacyId) : undefined,
      alias: body.alias !== undefined ? String(body.alias).trim() : undefined,
      aliasType: body.aliasType !== undefined ? String(body.aliasType) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    },
  });

  return NextResponse.json(alias);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  await prisma.pharmacyAlias.delete({ where: { id: Number((await params).id) } });
  return NextResponse.json({ ok: true });
}
