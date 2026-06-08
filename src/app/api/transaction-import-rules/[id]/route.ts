import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const body = await request.json();
  const distributionType =
    body.distributionType !== undefined ? String(body.distributionType) : undefined;

  const rule = await prisma.transactionImportRule.update({
    where: { id },
    data: {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      sourceField: body.sourceField !== undefined ? String(body.sourceField) : undefined,
      pattern: body.pattern !== undefined ? String(body.pattern).trim() : undefined,
      matchType: body.matchType !== undefined ? String(body.matchType) : undefined,
      targetFieldKey:
        body.targetFieldKey !== undefined
          ? body.targetFieldKey
            ? String(body.targetFieldKey)
            : null
          : undefined,
      distributionType,
      pharmacyId:
        body.pharmacyId !== undefined
          ? body.pharmacyId
            ? Number(body.pharmacyId)
            : null
          : undefined,
      priority: body.priority !== undefined ? Number(body.priority) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    },
  });

  return NextResponse.json(rule);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  await prisma.transactionImportRule.delete({ where: { id: Number((await params).id) } });
  return NextResponse.json({ ok: true });
}
