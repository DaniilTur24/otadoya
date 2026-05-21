import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const upload = await prisma.uploadedFile.findFirst({
    where: {
      id: Number(params.id),
      fileType: 'bank_transactions_excel',
    },
    include: {
      _count: {
        select: {
          importedTransactions: true,
          importedReportValues: true,
        },
      },
    },
  });

  if (!upload) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
  return NextResponse.json(upload);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const upload = await prisma.uploadedFile.findUnique({ where: { id: Number(params.id) } });
  if (!upload) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

  await prisma.uploadedFile.delete({ where: { id: Number(params.id) } });
  await deleteFile(upload.filename);

  return NextResponse.json({ ok: true });
}
