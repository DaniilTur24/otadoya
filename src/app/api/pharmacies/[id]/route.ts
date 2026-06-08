import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: Number((await params).id) } });
  if (!pharmacy) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
  return NextResponse.json(pharmacy);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const { name, isActive, keywords, coefficient, terminalRent, procedureRent } = await request.json();

  const pharmacy = await prisma.pharmacy.update({
    where: { id },
    data: {
      ...(name?.trim() ? { name: name.trim() } : {}),
      isActive:     isActive     !== undefined ? Boolean(isActive) : undefined,
      keywords:      typeof keywords === 'string' ? keywords.trim() : undefined,
      coefficient:   coefficient   != null ? String(coefficient)   : undefined,
      terminalRent:  terminalRent  != null ? String(terminalRent)  : undefined,
      procedureRent: procedureRent != null ? String(procedureRent) : undefined,
    },
  });

  return NextResponse.json(pharmacy);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  await prisma.pharmacy.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
