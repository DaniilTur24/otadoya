import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
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
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.pharmacyAlias.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ ok: true });
}
