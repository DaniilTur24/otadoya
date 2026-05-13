import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const category = searchParams.get('category');

  const where: Record<string, unknown> = { fileId: Number(params.id) };
  if (status && status !== 'all') where.status = status;
  if (category && category !== 'all') where.category = category;

  const expenses = await prisma.extractedExpenseEntry.findMany({
    where,
    include: { pharmacy: true },
    orderBy: { operationDate: 'desc' },
  });

  return NextResponse.json(
    expenses.map((e) => ({ ...e, amount: Number(e.amount) }))
  );
}
