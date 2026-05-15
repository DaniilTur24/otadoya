import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import {
  importParsedBankTransactions,
  parseBankTransactionsExcel,
} from '@/lib/bank-transaction-import';

export const dynamic = 'force-dynamic';

export async function GET() {
  const files = await prisma.uploadedFile.findMany({
    where: { fileType: 'bank_transactions_excel' },
    include: {
      _count: {
        select: {
          importedTransactions: true,
          importedReportValues: true,
        },
      },
    },
    orderBy: { uploadedAt: 'desc' },
  });

  return NextResponse.json(files);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const month = Number(formData.get('month'));
  const year = Number(formData.get('year'));

  if (!file) {
    return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 });
  }

  if (!month || month < 1 || month > 12 || !year || year < 2000) {
    return NextResponse.json({ error: 'Выберите корректный месяц и год' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const transactions = parseBankTransactionsExcel(buffer);

  if (transactions.length === 0) {
    return NextResponse.json(
      { error: 'Не удалось найти строки транзакций в файле' },
      { status: 400 }
    );
  }

  const uploadsDir = path.join(process.cwd(), 'uploads');
  await mkdir(uploadsDir, { recursive: true });

  const safeName = file.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_');
  const filename = `${Date.now()}_${safeName}`;
  await writeFile(path.join(uploadsDir, filename), buffer);

  const result = await prisma.$transaction(async (tx) => {
    const upload = await tx.uploadedFile.create({
      data: {
        filename,
        originalName: file.name,
        fileType: 'bank_transactions_excel',
        month,
        year,
      },
    });

    const stats = await importParsedBankTransactions(tx, upload.id, transactions);

    return { upload, stats };
  });

  return NextResponse.json(
    {
      id: result.upload.id,
      originalName: result.upload.originalName,
      importedCount: result.stats.importedCount,
      needsReviewCount: result.stats.needsReviewCount,
      ignoredCount: result.stats.ignoredCount,
    },
    { status: 201 }
  );
}
