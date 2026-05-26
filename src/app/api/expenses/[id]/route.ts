import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const body = await request.json();
  const { category, pharmacyId, reviewerComment, status, amount } = body;

  const data: Record<string, unknown> = {};
  if (category) data.category = category;
  if (pharmacyId !== undefined) data.pharmacyId = pharmacyId ? Number(pharmacyId) : null;
  if (reviewerComment !== undefined) data.reviewerComment = reviewerComment || null;
  if (status) data.status = status;
  if (amount != null) data.amount = String(amount);

  const entry = await prisma.extractedExpenseEntry.update({
    where: { id: Number((await params).id) },
    data,
    include: { pharmacy: true },
  });

  return NextResponse.json({ ...entry, amount: Number(entry.amount) });
}
