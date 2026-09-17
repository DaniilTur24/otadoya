import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrBookkeeper } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminOrBookkeeper(request);
  if (auth) return auth;

  const pharmacy = await prisma.pharmacy.findUnique({ where: { id: Number((await params).id) } });
  if (!pharmacy) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });
  return NextResponse.json(pharmacy);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const {
    name, isActive, keywords, coefficient, terminalRent, procedureRent,
    managerPremiumThreshold, managerPremiumBase,
    managerPremiumStepAmount, managerPremiumStepBonus,
    poolAverageRevenuePremium,
  } = await request.json();

  const pharmacy = await prisma.pharmacy.update({
    where: { id },
    data: {
      ...(name?.trim() ? { name: name.trim() } : {}),
      isActive:     isActive     !== undefined ? Boolean(isActive) : undefined,
      keywords:      typeof keywords === 'string' ? keywords.trim() : undefined,
      coefficient:   coefficient   != null ? String(coefficient)   : undefined,
      terminalRent:  terminalRent  != null ? String(terminalRent)  : undefined,
      procedureRent: procedureRent != null ? String(procedureRent) : undefined,
      managerPremiumThreshold:
        managerPremiumThreshold !== undefined ? (managerPremiumThreshold != null ? String(managerPremiumThreshold) : null) : undefined,
      managerPremiumBase:
        managerPremiumBase !== undefined ? (managerPremiumBase != null ? String(managerPremiumBase) : null) : undefined,
      managerPremiumStepAmount:
        managerPremiumStepAmount !== undefined ? (managerPremiumStepAmount != null ? String(managerPremiumStepAmount) : null) : undefined,
      managerPremiumStepBonus:
        managerPremiumStepBonus !== undefined ? (managerPremiumStepBonus != null ? String(managerPremiumStepBonus) : null) : undefined,
      poolAverageRevenuePremium:
        poolAverageRevenuePremium !== undefined ? Boolean(poolAverageRevenuePremium) : undefined,
    },
  });

  return NextResponse.json(pharmacy);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const existing = await prisma.pharmacy.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });

  // Раньше удаление шло без проверок: при записях выручки падало необработанным исключением
  // (связь без onDelete → Restrict), а PDF-отчёты, ручные правки отчёта, привязки сотрудников
  // и заведующих, табель и строки импорта каскадом стирались молча (QA раунд 4, №18).
  // Если у аптеки есть любая история — деактивируем, как сотрудников и заведующих.
  const [revenue, attendance, expenses, imported, pdf, overrides, employeeLinks, userLinks, files] = await Promise.all([
    prisma.dailyRevenueEntry.count({ where: { pharmacyId: id } }),
    prisma.attendanceShift.count({ where: { pharmacyId: id } }),
    prisma.extractedExpenseEntry.count({ where: { pharmacyId: id } }),
    prisma.importedReportValue.count({ where: { pharmacyId: id } }),
    prisma.pharmacyPdfReport.count({ where: { pharmacyId: id } }),
    prisma.monthlyReportOverride.count({ where: { pharmacyId: id } }),
    prisma.employeePharmacy.count({ where: { pharmacyId: id } }),
    prisma.userPharmacy.count({ where: { pharmacyId: id } }),
    prisma.uploadedFile.count({ where: { pharmacyId: id } }),
  ]);
  const historyCount = revenue + attendance + expenses + imported + pdf + overrides + employeeLinks + userLinks + files;

  if (historyCount > 0) {
    await prisma.pharmacy.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({
      ok: true,
      deactivated: true,
      message: 'У аптеки есть записи выручки, табель, расходы или привязанные сотрудники — она деактивирована, а не удалена, чтобы не стереть историю',
    });
  }

  await prisma.pharmacy.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
