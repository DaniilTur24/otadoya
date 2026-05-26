import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parsePdfReport } from '@/lib/pdf-report-parser';
import { requireAdmin } from '@/lib/api-auth';
import { validatePdfFile } from '@/lib/upload-limits';

export const dynamic = 'force-dynamic';

// GET — список всех загруженных PDF-отчётов
export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const pharmacyId = searchParams.get('pharmacyId');
  const year       = searchParams.get('year');
  const month      = searchParams.get('month');

  const where: Record<string, unknown> = {};
  if (pharmacyId) where.pharmacyId = Number(pharmacyId);
  if (year)       where.year       = Number(year);
  if (month)      where.month      = Number(month);

  const reports = await prisma.pharmacyPdfReport.findMany({
    where,
    include: { pharmacy: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  return NextResponse.json(
    reports.map((r) => ({
      ...r,
      markupPercent:  r.markupPercent  ? Number(r.markupPercent)  : null,
      stockRetail:    r.stockRetail    ? Number(r.stockRetail)    : null,
      stockWholesale: r.stockWholesale ? Number(r.stockWholesale) : null,
    }))
  );
}

// POST — загрузить PDF, извлечь данные (НЕ сохранять — только вернуть превью)
export async function POST(request: NextRequest) {
  const auth = requireAdmin(request);
  if (auth) return auth;

  const formData   = await request.formData();
  const file       = formData.get('file') as File | null;
  const pharmacyId = formData.get('pharmacyId') as string | null;
  const year       = formData.get('year') as string | null;
  const month      = formData.get('month') as string | null;

  if (!file || !pharmacyId || !year || !month) {
    return NextResponse.json(
      { error: 'Обязательные поля: файл, аптека, год, месяц' },
      { status: 400 }
    );
  }

  const fileValidation = validatePdfFile(file);
  if (fileValidation) return fileValidation;

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parsePdfReport(buffer);
  } catch (e) {
    return NextResponse.json(
      { error: `Ошибка парсинга PDF: ${e instanceof Error ? e.message : 'неизвестная ошибка'}` },
      { status: 422 }
    );
  }

  return NextResponse.json({
    pharmacyId:    Number(pharmacyId),
    year:          Number(year),
    month:         Number(month),
    fileName:      file.name,
    ...parsed,
    // retailMethod показывает какой из 4 методов сработал — для отладки
  });
}
