import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const body = await request.json().catch(() => ({}));
  const { reviewerComment } = body;

  const entry = await prisma.extractedExpenseEntry.update({
    where: { id: Number((await params).id) },
    data: {
      status: 'rejected',
      reviewerComment: reviewerComment || null,
    },
  });

  return NextResponse.json({ ...entry, amount: Number(entry.amount) });
}
