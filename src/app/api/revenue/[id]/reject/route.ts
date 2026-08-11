import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrBookkeeper } from '@/lib/api-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const body = await request.json().catch(() => ({}));
  const { bookkeeperComment } = body;

  const entry = await prisma.dailyRevenueEntry.update({
    where: { id: Number((await params).id) },
    data: {
      status: 'rejected',
      bookkeeperComment: bookkeeperComment || null,
    },
  });

  return NextResponse.json(entry);
}
