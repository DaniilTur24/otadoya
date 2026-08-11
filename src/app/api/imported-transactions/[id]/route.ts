import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { regenerateImportedReportValues } from '@/lib/bank-transaction-import';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const transaction = await prisma.importedTransaction.findUnique({
    where: { id: Number((await params).id) },
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
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
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

  // Ручное распределение суммы транзакции по аптекам — раньше не проверялось вообще:
  // некорректная сумма/несуществующая аптека падали в БД как есть (или ловили FK-ошибку
  // прямо на insert), а сумма разбивки могла не совпадать с суммой самой транзакции —
  // отчёт по аптекам молча не сходился бы с банковской выпиской.
  if (distributionType === 'split_custom') {
    if (!customDistribution || customDistribution.length === 0) {
      return NextResponse.json(
        { error: 'Укажите распределение суммы хотя бы по одной аптеке' },
        { status: 400 }
      );
    }

    const transaction = await prisma.importedTransaction.findUnique({ where: { id }, select: { amount: true } });
    if (!transaction) return NextResponse.json({ error: 'Транзакция не найдена' }, { status: 404 });

    let sumCents = 0;
    const pharmacyIds = new Set<number>();
    for (const item of customDistribution) {
      const amountNum = Number(item.amount);
      if (!Number.isFinite(amountNum) || amountNum < 0) {
        return NextResponse.json({ error: 'Некорректная сумма в распределении по аптекам' }, { status: 400 });
      }
      if (!Number.isInteger(item.pharmacyId) || item.pharmacyId <= 0) {
        return NextResponse.json({ error: 'Некорректная аптека в распределении' }, { status: 400 });
      }
      sumCents += Math.round(amountNum * 100);
      pharmacyIds.add(item.pharmacyId);
    }

    const txAmountCents = Math.round(Number(transaction.amount) * 100);
    if (sumCents !== txAmountCents) {
      return NextResponse.json(
        {
          error: `Сумма распределения (${(sumCents / 100).toFixed(2)}) не равна сумме транзакции (${(txAmountCents / 100).toFixed(2)})`,
        },
        { status: 400 }
      );
    }

    const existingCount = await prisma.pharmacy.count({ where: { id: { in: [...pharmacyIds] } } });
    if (existingCount !== pharmacyIds.size) {
      return NextResponse.json({ error: 'В распределении указана несуществующая аптека' }, { status: 400 });
    }
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
