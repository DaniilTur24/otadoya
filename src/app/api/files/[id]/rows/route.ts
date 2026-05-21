import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseAllFileRows } from '@/lib/excel-parser';
import { downloadFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/files/[id]/rows?search=текст
 * Возвращает все строки файла, опционально отфильтрованные по поисковому запросу.
 * Каждая строка содержит флаг `alreadyAdded` (уже добавлена в расходы) и `expenseId`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const fileId = Number(params.id);
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim().toLowerCase() || '';

  // Находим файл в БД
  const uploadedFile = await prisma.uploadedFile.findUnique({
    where: { id: fileId },
  });
  if (!uploadedFile) {
    return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await downloadFile(uploadedFile.filename);
  } catch {
    return NextResponse.json({ error: 'Файл не найден в хранилище' }, { status: 404 });
  }

  // Парсим все строки
  const allRows = parseAllFileRows(buffer);

  // Получаем уже добавленные расходы из этого файла (для пометки)
  const existingEntries = await prisma.extractedExpenseEntry.findMany({
    where: { fileId },
    select: { id: true, rowIndex: true, status: true, category: true, isManual: true },
  });

  // Быстрый lookup по rowIndex
  const existingByRowIndex = new Map(
    existingEntries
      .filter((e) => e.rowIndex !== null)
      .map((e) => [e.rowIndex!, e])
  );

  // Фильтрация по поиску
  const filtered = search
    ? allRows.filter((row) => {
        const text = [row.description, row.counterparty].join(' ').toLowerCase();
        return text.includes(search);
      })
    : allRows;

  const result = filtered.map((row) => {
    const existing = existingByRowIndex.get(row.rowIndex);
    return {
      ...row,
      operationDate: row.operationDate?.toISOString() ?? null,
      alreadyAdded: !!existing,
      expenseId: existing?.id ?? null,
      expenseStatus: existing?.status ?? null,
      expenseCategory: existing?.category ?? null,
    };
  });

  return NextResponse.json({
    rows: result,
    total: allRows.length,
    filtered: result.length,
  });
}

/**
 * POST /api/files/[id]/rows
 * Вручную добавляет строку из файла как расход/аренду.
 * Body: { rowIndex, category, pharmacyId?, operationDate, amount, counterparty, description }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const fileId = Number(params.id);
  const body = await request.json();
  const { rowIndex, category, pharmacyId, operationDate, amount, counterparty, description } = body;

  if (!category || !description) {
    return NextResponse.json(
      { error: 'Обязательные поля: category, description' },
      { status: 400 }
    );
  }

  if (category !== 'rent' && category !== 'expense') {
    return NextResponse.json(
      { error: 'Категория: rent или expense' },
      { status: 400 }
    );
  }

  // Проверяем, не добавлена ли уже эта строка
  if (rowIndex !== undefined && rowIndex !== null) {
    const existing = await prisma.extractedExpenseEntry.findFirst({
      where: { fileId, rowIndex },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Эта строка уже добавлена', expenseId: existing.id },
        { status: 409 }
      );
    }
  }

  const entry = await prisma.extractedExpenseEntry.create({
    data: {
      fileId,
      pharmacyId: pharmacyId ? Number(pharmacyId) : null,
      operationDate: operationDate ? new Date(operationDate) : new Date(),
      amount: String(amount || '0'),
      counterparty: counterparty || null,
      description,
      category,
      status: 'pending',
      isManual: true,
      rowIndex: rowIndex ?? null,
    },
  });

  return NextResponse.json(
    { ...entry, amount: Number(entry.amount) },
    { status: 201 }
  );
}
