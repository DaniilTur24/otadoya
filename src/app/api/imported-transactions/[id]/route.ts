import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { regenerateImportedReportValues } from '@/lib/bank-transaction-import';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const transaction = await prisma.importedTransaction.findUnique({
    where: { id: Number(params.id) },
    include: {
      matchedRule: true,
      detectedPharmacy: true,
      reportValues: {
        include: {
          pharmacy: true,
        },
      },
    },
  });

  if (!transaction) return NextResponse.json({ error: 'Транзакция не найдена' }, { status: 404 });
  return NextResponse.json(transaction);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const body = await request.json();
  const distributionType = body.distributionType ? String(body.distributionType) : null;
  const fieldKey = body.fieldKey ? String(body.fieldKey) : null;
  const pharmacyId = body.pharmacyId ? Number(body.pharmacyId) : null;
  const status = body.status ? String(body.status) : undefined;
  const customDistribution = Array.isArray(body.customDistribution)
    ? (body.customDistribution as { pharmacyId: number; amount: string }[])
    : null;

  const VALID_STATUSES = ['pending', 'approved', 'rejected', 'needs_review'];
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Некорректный статус: ${status}` }, { status: 400 });
  }
  const accountantComment =
    typeof body.accountantComment === 'string' ? body.accountantComment.trim() || null : undefined;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await regenerateImportedReportValues(tx, id, {
      fieldKey,
      distributionType,
      pharmacyId,
      status,
      customDistribution,
    });

    if (accountantComment !== undefined) {
      await tx.importedTransaction.update({
        where: { id },
        data: { accountantComment },
      });
    }

    return updated;
  });

  return NextResponse.json({ ok: true, ...result });
}
