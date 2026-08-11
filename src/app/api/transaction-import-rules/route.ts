import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BANK_IMPORT_TARGET_FIELDS } from '@/lib/monthly-report-fields';
import { requireAdmin } from '@/lib/api-auth';
import { unsafeRegexReason } from '@/lib/regex-safety';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const rules = await prisma.transactionImportRule.findMany({
    include: {
      pharmacy: true,
    },
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
  });

  return NextResponse.json(
    rules.map((rule) => ({
      ...rule,
      targetFieldLabel:
        BANK_IMPORT_TARGET_FIELDS.find((field) => field.key === rule.targetFieldKey)?.label ?? null,
    }))
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const body = await request.json();
  const name = String(body.name ?? '').trim();
  const pattern = String(body.pattern ?? '').trim();
  const matchType = String(body.matchType || 'contains');
  const distributionType = String(body.distributionType || 'detect_pharmacy_from_text');

  if (!name || !pattern) {
    return NextResponse.json({ error: 'Название и pattern обязательны' }, { status: 400 });
  }

  if (matchType === 'regex') {
    try {
      new RegExp(pattern);
    } catch {
      return NextResponse.json({ error: 'Некорректное регулярное выражение' }, { status: 400 });
    }
    const unsafeReason = unsafeRegexReason(pattern);
    if (unsafeReason) {
      return NextResponse.json({ error: unsafeReason }, { status: 400 });
    }
  }

  const rule = await prisma.transactionImportRule.create({
    data: {
      name,
      sourceField: String(body.sourceField || 'any_text'),
      pattern,
      matchType,
      targetFieldKey: String(body.targetFieldKey || '') || null,
      distributionType,
      pharmacyId:
        distributionType === 'specific_pharmacy' && body.pharmacyId
          ? Number(body.pharmacyId)
          : null,
      priority: Number(body.priority ?? 0),
      isActive: body.isActive ?? true,
    },
  });

  return NextResponse.json(rule, { status: 201 });
}
