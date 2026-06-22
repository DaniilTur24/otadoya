import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function serialize(s: Record<string, unknown>) {
  return {
    threshold: Number(s.threshold),
    base: Number(s.base),
    stepAmount: Number(s.stepAmount),
    stepBonus: Number(s.stepBonus),
  };
}

const EMPTY = { threshold: 0, base: 0, stepAmount: 0, stepBonus: 0 };

// GET /api/office-premium-settings — глобальная лестница премии офиса от выручки всех аптек
export async function GET(request: NextRequest) {
  const auth = requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const settings = await prisma.officePremiumSettings.findFirst();
  return NextResponse.json(settings ? serialize(settings as unknown as Record<string, unknown>) : EMPTY);
}

export async function PUT(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const { threshold, base, stepAmount, stepBonus } = await request.json();

  const existing = await prisma.officePremiumSettings.findFirst();
  const data = {
    threshold: String(threshold ?? 0),
    base: String(base ?? 0),
    stepAmount: String(stepAmount ?? 0),
    stepBonus: String(stepBonus ?? 0),
  };

  const settings = existing
    ? await prisma.officePremiumSettings.update({ where: { id: existing.id }, data })
    : await prisma.officePremiumSettings.create({ data });

  return NextResponse.json(serialize(settings as unknown as Record<string, unknown>));
}
