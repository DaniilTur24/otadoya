import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => ({}));
  const { reviewerComment } = body;

  const entry = await prisma.extractedExpenseEntry.update({
    where: { id: Number(params.id) },
    data: {
      status: 'approved',
      reviewerComment: reviewerComment || null,
    },
  });

  return NextResponse.json({ ...entry, amount: Number(entry.amount) });
}
