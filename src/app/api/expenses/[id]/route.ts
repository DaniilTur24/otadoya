import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { category, pharmacyId, reviewerComment, status, amount } = body;

  const data: Record<string, unknown> = {};
  if (category) data.category = category;
  if (pharmacyId !== undefined) data.pharmacyId = pharmacyId ? Number(pharmacyId) : null;
  if (reviewerComment !== undefined) data.reviewerComment = reviewerComment || null;
  if (status) data.status = status;
  if (amount != null) data.amount = String(amount);

  const entry = await prisma.extractedExpenseEntry.update({
    where: { id: Number(params.id) },
    data,
    include: { pharmacy: true },
  });

  return NextResponse.json({ ...entry, amount: Number(entry.amount) });
}
