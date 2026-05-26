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

  const approvedCount = await prisma.importedTransaction.count({
    where: { uploadId: Number(params.id), status: 'approved' },
  });
  if (approvedCount > 0) {
    return NextResponse.json(
      { error: `Нельзя удалить файл: ${approvedCount} транзакций уже одобрены. Сначала отклоните их.` },
      { status: 409 }
    );
  }

  await prisma.uploadedFile.delete({ where: { id: Number(params.id) } });
  try {
    await deleteFile(upload.filename);
  } catch (err) {
    console.error('Не удалось удалить файл из хранилища (сиротский файл):', upload.filename, err);
  }

  return NextResponse.json({ ok: true });
}
