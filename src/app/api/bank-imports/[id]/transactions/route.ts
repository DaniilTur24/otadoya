import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const uploadId = Number((await params).id);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search')?.trim();

  const upload = await prisma.uploadedFile.findFirst({
    where: { id: uploadId, fileType: 'bank_transactions_excel' },
  });

  if (!upload) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

  const transactions = await prisma.importedTransaction.findMany({
    where: {
      uploadId,
      ...(status && status !== 'all' ? { status } : {}),
      ...(search
        ? {
            searchableText: {
              contains: search,
            },
          }
        : {}),
    },
    include: {
      matchedRule: true,
      detectedPharmacy: true,
      reportValues: {
        include: {
          pharmacy: true,
        },
        orderBy: [{ pharmacy: { name: 'asc' } }, { id: 'asc' }],
      },
    },
    orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
  });

  const counts = await prisma.importedTransaction.groupBy({
    by: ['status'],
    where: { uploadId },
    _count: { status: true },
  });

  return NextResponse.json({
    upload,
    transactions,
    counts: counts.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count.status;
      return acc;
    }, {}),
  });
}
