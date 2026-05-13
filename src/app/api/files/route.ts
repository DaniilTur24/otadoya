import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseExcelFile } from '@/lib/excel-parser';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// Принудительно динамический роут (не кешируем)
export const dynamic = 'force-dynamic';

export async function GET() {
  const files = await prisma.uploadedFile.findMany({
    include: {
      pharmacy: true,
      _count: { select: { expenses: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(files);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const pharmacyId = formData.get('pharmacyId') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Сохраняем файл на диск
  const uploadsDir = path.join(process.cwd(), 'uploads');
  await mkdir(uploadsDir, { recursive: true });

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${timestamp}_${safeName}`;
  const filepath = path.join(uploadsDir, filename);
  await writeFile(filepath, buffer);

  // Парсим Excel и извлекаем расходы/аренду
  let parsedExpenses: Awaited<ReturnType<typeof parseExcelFile>> = [];
  let parseError: string | null = null;
  try {
    parsedExpenses = parseExcelFile(buffer);
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'Ошибка парсинга файла';
  }

  // Сохраняем запись о файле и найденные расходы в одной транзакции
  const uploadedFile = await prisma.$transaction(async (tx) => {
    const created = await tx.uploadedFile.create({
      data: {
        filename,
        originalName: file.name,
        pharmacyId: pharmacyId ? Number(pharmacyId) : null,
      },
    });

    if (parsedExpenses.length > 0) {
      await tx.extractedExpenseEntry.createMany({
        data: parsedExpenses.map((e) => ({
          fileId: created.id,
          pharmacyId: pharmacyId ? Number(pharmacyId) : null,
          operationDate: e.operationDate,
          amount: e.amount,
          counterparty: e.counterparty,
          description: e.description,
          category: e.category,
          status: 'pending',
          isManual: false,
          rowIndex: e.rowIndex,
        })),
      });
    }

    return created;
  });

  return NextResponse.json(
    {
      id: uploadedFile.id,
      filename,
      originalName: file.name,
      extractedCount: parsedExpenses.length,
      parseError,
    },
    { status: 201 }
  );
}
