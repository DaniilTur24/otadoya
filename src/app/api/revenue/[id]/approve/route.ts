import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => ({}));
  const { bookkeeperComment } = body;

  const entry = await prisma.dailyRevenueEntry.update({
    where: { id: Number(params.id) },
    data: {
      status: 'approved',
      bookkeeperComment: bookkeeperComment || null,
    },
  });

  return NextResponse.json(entry);
}
