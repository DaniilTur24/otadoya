import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const { name, keywords, coefficient, terminalRent, procedureRent } = await request.json();

  const pharmacy = await prisma.pharmacy.update({
    where: { id },
    data: {
      ...(name?.trim() ? { name: name.trim() } : {}),
      keywords:      typeof keywords === 'string' ? keywords.trim() : undefined,
      coefficient:   coefficient   != null ? String(coefficient)   : undefined,
      terminalRent:  terminalRent  != null ? String(terminalRent)  : undefined,
      procedureRent: procedureRent != null ? String(procedureRent) : undefined,
    },
  });

  return NextResponse.json(pharmacy);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  await prisma.pharmacy.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
