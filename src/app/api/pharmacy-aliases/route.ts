import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pharmacyId = searchParams.get('pharmacyId');

  const aliases = await prisma.pharmacyAlias.findMany({
    where: pharmacyId ? { pharmacyId: Number(pharmacyId) } : {},
    include: { pharmacy: true },
    orderBy: [{ pharmacy: { name: 'asc' } }, { alias: 'asc' }],
  });

  return NextResponse.json(aliases);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pharmacyId = Number(body.pharmacyId);
  const alias = String(body.alias ?? '').trim();

  if (!pharmacyId || !alias) {
    return NextResponse.json({ error: 'Аптека и алиас обязательны' }, { status: 400 });
  }

  const created = await prisma.pharmacyAlias.create({
    data: {
      pharmacyId,
      alias,
      aliasType: String(body.aliasType || 'keyword'),
      isActive: body.isActive ?? true,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
