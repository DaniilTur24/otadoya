import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper, getRequestUserId } from '@/lib/api-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const body = await request.json().catch(() => ({}));
  const { bookkeeperComment } = body;
  const approvedById = getRequestUserId(request);

  const entry = await prisma.dailyRevenueEntry.update({
    where: { id: Number((await params).id) },
    data: {
      status: 'approved',
      bookkeeperComment: bookkeeperComment || null,
      approvedAt: new Date(),
      ...(approvedById ? { approvedById } : {}),
    },
  });

  return NextResponse.json(entry);
}
