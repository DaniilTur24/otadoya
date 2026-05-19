import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MONTHLY_REPORT_ROWS } from '@/lib/monthly-report-fields';

export const dynamic = 'force-dynamic';

export async function GET() {
  const saved = await prisma.monthlyFieldConfig.findMany();
  const savedMap = Object.fromEntries(saved.map((c) => [c.fieldKey, c.rowType]));

  const result = MONTHLY_REPORT_ROWS
    .filter((row) => !row.section)
    .map((row) => ({
      fieldKey: row.key,
      label: row.label,
      rowType: savedMap[row.key] ?? row.rowType ?? 'neutral',
    }));

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest) {
  const { fieldKey, rowType } = await request.json();

  if (!fieldKey || !['income', 'expense', 'neutral'].includes(rowType)) {
    return NextResponse.json({ error: 'Неверные данные' }, { status: 400 });
  }

  const config = await prisma.monthlyFieldConfig.upsert({
    where: { fieldKey },
    update: { rowType },
    create: { fieldKey, rowType },
  });

  return NextResponse.json(config);
}
