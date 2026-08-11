import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAnyRole, getRequestRole, getRequestUserId, getManagerPharmacyIds } from '@/lib/api-auth';
import { validateShiftEmployeeType, validateUniqueShift, validateNonNegativeAmounts } from '@/lib/revenue-validation';

async function canModifyEntry(
  request: Request,
  entry: { pharmacyId: number; status: string; submittedById: number | null }
): Promise<boolean> {
  const role = getRequestRole(request);
  if (role === 'admin' || role === 'bookkeeper') return true;
  if (role === 'manager') {
    const userId = getRequestUserId(request);
    // Менеджер может редактировать только свои записи в статусе pending
    return entry.submittedById === userId && entry.status === 'pending';
  }
  return false;
}

async function isMonthClosed(date: Date): Promise<boolean> {
  const year  = date.getFullYear();
  const month = date.getMonth() + 1;
  const closed = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
  return !!closed;
}

function serialize(entry: Record<string, unknown>) {
  const items = (entry.expenseItems as { amount: unknown; comment: unknown; employeeId: unknown }[] | undefined) ?? [];
  return {
    ...entry,
    cashRevenue: Number(entry.cashRevenue),
    terminalRevenue: Number(entry.terminalRevenue),
    kaspiRevenue: Number(entry.kaspiRevenue ?? 0),
    bonusRevenue: Number(entry.bonusRevenue ?? 0),
    additionalExpenses: Number(entry.additionalExpenses),
    totalRevenue: Number(entry.cashRevenue) + Number(entry.terminalRevenue) + Number(entry.kaspiRevenue ?? 0),
    expenseItems: items.map((i) => ({ ...i, amount: Number(i.amount) })),
  };
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const entry = await prisma.dailyRevenueEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  if (!await canModifyEntry(request, entry)) {
    return NextResponse.json({ error: 'Нет доступа к этой записи' }, { status: 403 });
  }

  if (await isMonthClosed(entry.date)) {
    return NextResponse.json({ error: 'Месяц закрыт — удаление невозможно' }, { status: 423 });
  }

  await prisma.dailyRevenueEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const id = Number((await params).id);
  const existing = await prisma.dailyRevenueEntry.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });

  if (!await canModifyEntry(request, existing)) {
    return NextResponse.json({ error: 'Нет доступа к этой записи' }, { status: 403 });
  }

  if (await isMonthClosed(existing.date)) {
    return NextResponse.json({ error: 'Месяц закрыт — изменения невозможны' }, { status: 423 });
  }

  const body = await request.json();
  const {
    pharmacyId, date, cashRevenue, terminalRevenue, kaspiRevenue, bonusRevenue,
    expenseItems, generalComment, employeeName, employeeId, shiftType,
    bookkeeperComment, status, excludedFromReport,
  } = body;

  const VALID_STATUSES = ['pending', 'approved', 'rejected'];
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Некорректный статус: ${status}` }, { status: 400 });
  }

  if (shiftType && !['day', 'full_day', 'five_day'].includes(shiftType)) {
    return NextResponse.json({ error: 'Недопустимый тип смены' }, { status: 400 });
  }

  // Дата могла измениться — нужно проверить закрытость и НОВОГО месяца, а не только старого,
  // иначе запись из открытого месяца можно перенести датой в уже закрытый и она начнёт незаметно
  // влиять на расчёт зарплаты за закрытый период (отчёт за него остаётся замороженным снапшотом).
  const effectiveDate = date ? new Date(date) : existing.date;
  if (date && await isMonthClosed(effectiveDate)) {
    return NextResponse.json({ error: 'Целевой месяц закрыт — перенести запись в него нельзя' }, { status: 423 });
  }

  const amountsError = validateNonNegativeAmounts({ cashRevenue, terminalRevenue, kaspiRevenue, bonusRevenue });
  if (amountsError) return NextResponse.json({ error: amountsError }, { status: 400 });

  // Аптека могла измениться — заведующий может редактировать только свою pending-запись,
  // но без этой проверки он мог бы переназначить её на чужую аптеку через смену pharmacyId.
  const effectivePharmacyId = pharmacyId != null ? Number(pharmacyId) : existing.pharmacyId;
  if (getRequestRole(request) === 'manager') {
    const allowedIds = await getManagerPharmacyIds(request);
    if (!allowedIds || !allowedIds.includes(effectivePharmacyId)) {
      return NextResponse.json({ error: 'Нет доступа к этой аптеке' }, { status: 403 });
    }
  }

  const effectiveEmployeeId = employeeId !== undefined ? (employeeId ? Number(employeeId) : null) : existing.employeeId;
  const effectiveShiftType = shiftType !== undefined ? (shiftType || null) : existing.shiftType;
  if (effectiveEmployeeId) {
    const shiftError = await validateShiftEmployeeType(effectiveEmployeeId, effectiveShiftType);
    if (shiftError) return NextResponse.json({ error: shiftError }, { status: 400 });

    const duplicateError = await validateUniqueShift(effectiveEmployeeId, effectiveDate, effectiveShiftType, id);
    if (duplicateError) return NextResponse.json({ error: duplicateError }, { status: 409 });
  }

  // Скалярные поля записи
  const data: Record<string, unknown> = {};
  if (pharmacyId != null) data.pharmacyId = Number(pharmacyId);
  if (date) data.date = new Date(date);
  if (cashRevenue != null) data.cashRevenue = String(cashRevenue);
  if (terminalRevenue != null) data.terminalRevenue = String(terminalRevenue);
  if (kaspiRevenue != null) data.kaspiRevenue = String(kaspiRevenue);
  if (bonusRevenue != null) data.bonusRevenue = String(bonusRevenue);
  if (generalComment !== undefined) data.generalComment = generalComment || null;
  if (employeeName) data.employeeName = employeeName.trim();
  if (employeeId !== undefined) data.employeeId = employeeId ? Number(employeeId) : null;
  if (shiftType !== undefined) data.shiftType = shiftType || null;
  if (bookkeeperComment !== undefined) data.bookkeeperComment = bookkeeperComment || null;
  // Подтверждение/отклонение — только через /approve и /reject (admin/bookkeeper). Без этой
  // проверки менеджер мог редактировать свою же pending-запись и сам выставить status:
  // 'approved', в обход бухгалтера, влияя на собственную зарплату (премия/бонусы считаются
  // только по approved-записям). excludedFromReport по той же причине — тоже решение бухгалтера.
  const requestRole = getRequestRole(request);
  const canSetReviewFields = requestRole === 'admin' || requestRole === 'bookkeeper';
  if (status && canSetReviewFields) data.status = status;
  if (excludedFromReport !== undefined && canSetReviewFields) data.excludedFromReport = excludedFromReport;

  // Если переданы строки расходов — пересохраняем их и пересчитываем сумму
  if (Array.isArray(expenseItems)) {
    const filled = expenseItems.filter((i: { amount: string }) => parseFloat(i.amount) > 0);

    // Авансы привязываются к конкретному сотруднику — проверяем, что он работает в этой аптеке
    const targetPharmacyId = pharmacyId != null ? Number(pharmacyId) : existing.pharmacyId;
    const advanceEmployeeIds = [
      ...new Set(
        filled
          .filter((i: { category?: string; employeeId?: number | null }) => i.category === 'employeeAdvance' && i.employeeId)
          .map((i: { employeeId?: number | null }) => Number(i.employeeId))
      ),
    ];
    if (advanceEmployeeIds.length > 0) {
      const links = await prisma.employeePharmacy.findMany({
        where: { employeeId: { in: advanceEmployeeIds }, pharmacyId: targetPharmacyId },
        select: { employeeId: true },
      });
      const linkedIds = new Set(links.map((l) => l.employeeId));
      if (advanceEmployeeIds.some((empId) => !linkedIds.has(empId))) {
        return NextResponse.json(
          { error: 'Аванс можно записать только сотруднику выбранной аптеки' },
          { status: 400 }
        );
      }
    }

    data.additionalExpenses = filled
      .reduce((s: number, i: { amount: string }) => s + (parseFloat(i.amount) || 0), 0)
      .toFixed(2);

    data.expenseComment =
      filled.length > 0
        ? filled
            .map((i: { amount: string; comment?: string }) =>
              i.comment
                ? `${parseFloat(i.amount).toLocaleString('ru-RU')} — ${i.comment}`
                : parseFloat(i.amount).toLocaleString('ru-RU')
            )
            .join('; ')
        : null;

    const entry = await prisma.$transaction(async (tx) => {
      await tx.dailyExpenseItem.deleteMany({ where: { entryId: id } });

      if (filled.length > 0) {
        await tx.dailyExpenseItem.createMany({
          data: filled.map((i: { amount: string; category?: string; comment?: string; employeeId?: number | null }) => ({
            entryId: id,
            amount: i.amount,
            category: i.category || null,
            comment: i.comment || null,
            employeeId: i.category === 'employeeAdvance' && i.employeeId ? Number(i.employeeId) : null,
          })),
        });
      }

      return tx.dailyRevenueEntry.update({
        where: { id },
        data,
        include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
      });
    });

    return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
  }

  // Если строки расходов не переданы — обновляем только скалярные поля
  const entry = await prisma.dailyRevenueEntry.update({
    where: { id },
    data,
    include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
  });

  return NextResponse.json(serialize(entry as unknown as Record<string, unknown>));
}
