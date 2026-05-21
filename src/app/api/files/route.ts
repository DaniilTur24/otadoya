import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseExcelFile } from '@/lib/excel-parser';
import { uploadFile } from '@/lib/storage';

// Принудительно динамический роут (не кешируем)
export const dynamic = 'force-dynamic';

export async function GET() {
  const files = await prisma.uploadedFile.findMany({
    where: {
      fileType: { not: 'bank_transactions_excel' },
    },
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

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${timestamp}_${safeName}`;
  await uploadFile(filename, buffer);

  // Парсим Excel и извлекаем расходы/аренду
  let parsedExpenses: Awaited<ReturnType<typeof parseExcelFile>> = [];
  let parseError: string | null = null;
  try {
    parsedExpenses = parseExcelFile(buffer);
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'Ошибка парсинга файла';
  }

  // Загружаем аптеки с ключевыми словами для автопривязки
  const allPharmacies = await prisma.pharmacy.findMany();
  const pharmacyKeywords = allPharmacies
    .filter((p) => p.keywords?.trim())
    .map((p) => ({
      id: p.id,
      keywords: p.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
    }));

  function autoDetectPharmacy(description: string, counterparty: string | null): number | null {
    const haystack = `${description} ${counterparty ?? ''}`.toLowerCase();
    for (const p of pharmacyKeywords) {
      if (p.keywords.some((kw) => haystack.includes(kw))) return p.id;
    }
    return null;
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
        data: parsedExpenses.map((e) => {
          // Для аренды: явно выбранная аптека → авто по ключевым словам
          // Для расходов: только явно выбранная аптека, авто не трогаем
          const detectedId = pharmacyId
            ? Number(pharmacyId)
            : e.category === 'rent'
            ? autoDetectPharmacy(e.description, e.counterparty ?? null)
            : null;
          return {
            fileId: created.id,
            pharmacyId: detectedId,
            operationDate: e.operationDate,
            amount: e.amount,
            counterparty: e.counterparty,
            description: e.description,
            category: e.category,
            status: 'pending',
            isManual: false,
            rowIndex: e.rowIndex,
          };
        }),
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
