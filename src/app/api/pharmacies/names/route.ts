import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// Только id и название всех аптек — для селектора «аптека расхода» в форме выручки: заведующий
// может отнести расход на любую аптеку, хотя полный список /api/pharmacies ему отдаёт лишь его собственные.
export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const pharmacies = await prisma.pharmacy.findMany({
    select: { id: true, name: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(pharmacies);
}
