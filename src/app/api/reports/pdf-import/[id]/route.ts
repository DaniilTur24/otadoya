import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PUT — создать или обновить запись (вызывается при подтверждении)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();

  // id здесь — "pharmacyId_year_month" для upsert
  // Но для простоты принимаем числовой id записи ИЛИ специальный формат
  // Если id === "new" — создаём, иначе обновляем
  const {
    pharmacyId, year, month,
    markupPercent, stockRetail, stockWholesale,
    sourceFile, confident,
  } = body;

  const record = await prisma.pharmacyPdfReport.upsert({
    where: {
      pharmacyId_year_month: {
        pharmacyId: Number(pharmacyId),
        year:       Number(year),
        month:      Number(month),
      },
    },
    update: {
      markupPercent:  markupPercent  != null ? String(markupPercent)  : null,
      stockRetail:    stockRetail    != null ? String(stockRetail)    : null,
      stockWholesale: stockWholesale != null ? String(stockWholesale) : null,
      status:    'confirmed',
      confident: confident ?? true,
      ...(sourceFile ? { sourceFile } : {}),
    },
    create: {
      pharmacyId:    Number(pharmacyId),
      year:          Number(year),
      month:         Number(month),
      markupPercent:  markupPercent  != null ? String(markupPercent)  : null,
      stockRetail:    stockRetail    != null ? String(stockRetail)    : null,
      stockWholesale: stockWholesale != null ? String(stockWholesale) : null,
      status:    'confirmed',
      confident: confident ?? true,
      sourceFile: sourceFile ?? null,
    },
  });

  return NextResponse.json({
    ...record,
    markupPercent:  record.markupPercent  ? Number(record.markupPercent)  : null,
    stockRetail:    record.stockRetail    ? Number(record.stockRetail)    : null,
    stockWholesale: record.stockWholesale ? Number(record.stockWholesale) : null,
  });
}

// DELETE — удалить запись
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.pharmacyPdfReport.delete({ where: { id: Number(params.id) } });
  return NextResponse.json({ ok: true });
}
