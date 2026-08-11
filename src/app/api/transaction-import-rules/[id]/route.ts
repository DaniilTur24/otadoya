import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/api-auth';
import { unsafeRegexReason } from '@/lib/regex-safety';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const body = await request.json();
  const distributionType =
    body.distributionType !== undefined ? String(body.distributionType) : undefined;
  const newMatchType = body.matchType !== undefined ? String(body.matchType) : undefined;
  const newPattern = body.pattern !== undefined ? String(body.pattern).trim() : undefined;

  // matchType/pattern можно менять по отдельности — проверяем итоговое состояние правила,
  // а не только то, что пришло в этом запросе, иначе можно подменить паттерн на опасный,
  // не трогая matchType (или наоборот).
  if (newMatchType === 'regex' || (newPattern !== undefined && newMatchType === undefined)) {
    const existing = await prisma.transactionImportRule.findUnique({ where: { id }, select: { matchType: true, pattern: true } });
    if (!existing) return NextResponse.json({ error: 'Правило не найдено' }, { status: 404 });

    const effectiveMatchType = newMatchType ?? existing.matchType;
    const effectivePattern = newPattern ?? existing.pattern;

    if (effectiveMatchType === 'regex') {
      try {
        new RegExp(effectivePattern);
      } catch {
        return NextResponse.json({ error: 'Некорректное регулярное выражение' }, { status: 400 });
      }
      const unsafeReason = unsafeRegexReason(effectivePattern);
      if (unsafeReason) {
        return NextResponse.json({ error: unsafeReason }, { status: 400 });
      }
    }
  }

  const rule = await prisma.transactionImportRule.update({
    where: { id },
    data: {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      sourceField: body.sourceField !== undefined ? String(body.sourceField) : undefined,
      pattern: newPattern,
      matchType: newMatchType,
      targetFieldKey:
        body.targetFieldKey !== undefined
          ? body.targetFieldKey
            ? String(body.targetFieldKey)
            : null
          : undefined,
      distributionType,
      pharmacyId:
        body.pharmacyId !== undefined
          ? body.pharmacyId
            ? Number(body.pharmacyId)
            : null
          : undefined,
      priority: body.priority !== undefined ? Number(body.priority) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    },
  });

  return NextResponse.json(rule);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  await prisma.transactionImportRule.delete({ where: { id: Number((await params).id) } });
  return NextResponse.json({ ok: true });
}
