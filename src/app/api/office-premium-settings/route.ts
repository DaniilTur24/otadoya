import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function serialize(t: Record<string, unknown>) {
  return {
    id: Number(t.id),
    fromAmount: Number(t.fromAmount),
    toAmount: t.toAmount != null ? Number(t.toAmount) : null,
    bonusAmount: Number(t.bonusAmount),
  };
}

/**
 * Без этой проверки админ мог бы случайно ввести пересекающиеся диапазоны — findOfficeTierBonus()
 * в salary-calculator.ts берёт первую подходящую строку по порядку fromAmount, так что при
 * пересечении выигрывает диапазон с меньшим fromAmount без явного предупреждения об этом.
 */
function validateTierRanges(
  tiers: { fromAmount: number; toAmount: number | null; bonusAmount: number }[],
): string | null {
  const sorted = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.toAmount != null && t.toAmount <= t.fromAmount) {
      return `Диапазон от ${t.fromAmount} — верхняя граница "до" должна быть больше нижней`;
    }
    if (t.toAmount == null && i !== sorted.length - 1) {
      return `Без верхней границы может быть только последний по порядку диапазон (от ${t.fromAmount})`;
    }
    const next = sorted[i + 1];
    if (next && t.toAmount != null && t.toAmount > next.fromAmount) {
      return `Диапазоны от ${t.fromAmount} и от ${next.fromAmount} пересекаются`;
    }
  }
  return null;
}

// GET /api/office-premium-settings — таблица диапазонов выручки → премия офиса (все аптеки)
export async function GET(request: NextRequest) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const tiers = await prisma.officePremiumTier.findMany({ orderBy: { fromAmount: 'asc' } });
  return NextResponse.json(tiers.map((t) => serialize(t as unknown as Record<string, unknown>)));
}

// PUT /api/office-premium-settings — body: { tiers: { fromAmount, toAmount, bonusAmount }[] }
// Полностью заменяет таблицу диапазонов переданным списком.
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const { tiers } = await request.json();
  if (!Array.isArray(tiers)) {
    return NextResponse.json({ error: 'tiers должен быть массивом' }, { status: 400 });
  }

  for (const t of tiers) {
    if (t.fromAmount == null || t.bonusAmount == null) {
      return NextResponse.json({ error: 'У каждой строки должны быть fromAmount и bonusAmount' }, { status: 400 });
    }
  }

  const rangeError = validateTierRanges(tiers);
  if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 });

  const saved = await prisma.$transaction(async (tx) => {
    await tx.officePremiumTier.deleteMany({});
    if (tiers.length === 0) return [];
    await tx.officePremiumTier.createMany({
      data: tiers.map((t: { fromAmount: number; toAmount: number | null; bonusAmount: number }) => ({
        fromAmount: String(t.fromAmount),
        toAmount: t.toAmount != null ? String(t.toAmount) : null,
        bonusAmount: String(t.bonusAmount),
      })),
    });
    return tx.officePremiumTier.findMany({ orderBy: { fromAmount: 'asc' } });
  });

  return NextResponse.json(saved.map((t) => serialize(t as unknown as Record<string, unknown>)));
}
