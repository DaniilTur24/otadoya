import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { monthlyFieldLabel } from '@/lib/monthly-report-fields';
import { requireAnyRole, getManagerPharmacyIds, getRequestRole, getRequestUserId } from '@/lib/api-auth';
import { validateShiftEmployeeType, validateUniqueShift, validateNoAttendanceOnDate, validateNonNegativeAmounts } from '@/lib/revenue-validation';

function serializeEntry(entry: Record<string, unknown>) {
  const items = (entry.expenseItems as { amount: unknown; comment: unknown; employeeId: unknown }[] | undefined) ?? [];
  return {
    ...entry,
    cashRevenue: Number(entry.cashRevenue),
    terminalRevenue: Number(entry.terminalRevenue),
    kaspiRevenue: Number(entry.kaspiRevenue ?? 0),
    bonusRevenue: Number(entry.bonusRevenue ?? 0),
    additionalExpenses: Number(entry.additionalExpenses),
    totalRevenue: Number(entry.cashRevenue) + Number(entry.terminalRevenue) + Number(entry.kaspiRevenue ?? 0),
    expenseItems: items.map((i) => ({
      ...i,
      amount: Number(i.amount),
    })),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const pharmacyId = searchParams.get('pharmacyId');

  const allowedIds = await getManagerPharmacyIds(request);

  const where: Record<string, unknown> = {};
  if (status && status !== 'all') where.status = status;

  if (allowedIds !== null) {
    // Менеджер видит все записи своих аптек
    where.pharmacyId = { in: allowedIds };
  } else if (pharmacyId) {
    where.pharmacyId = Number(pharmacyId);
  }

  const entries = await prisma.dailyRevenueEntry.findMany({
    where,
    include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json(entries.map((e) => serializeEntry(e as unknown as Record<string, unknown>)));
}

export async function POST(request: NextRequest) {
  const auth = await requireAnyRole(request);
  if (auth) return auth;

  const role = getRequestRole(request)!;
  const userId = getRequestUserId(request);
  const body = await request.json();

  const {
    pharmacyId,
    date,
    cashRevenue,
    terminalRevenue,
    kaspiRevenue,
    bonusRevenue,
    expenseItems,
    generalComment,
    employeeName,
    employeeId,
    shiftType,
  } = body;

  if (!pharmacyId || !date || cashRevenue == null || terminalRevenue == null || !employeeName) {
    return NextResponse.json(
      { error: 'Обязательные поля: аптека, дата, выручка наличными, выручка по терминалу, имя сотрудника' },
      { status: 400 }
    );
  }

  if (shiftType && !['day', 'full_day', 'five_day'].includes(shiftType)) {
    return NextResponse.json({ error: 'Недопустимый тип смены' }, { status: 400 });
  }

  const amountsError = validateNonNegativeAmounts({ cashRevenue, terminalRevenue, kaspiRevenue, bonusRevenue });
  if (amountsError) return NextResponse.json({ error: amountsError }, { status: 400 });

  const entryDate = new Date(date);
  const entryYear = entryDate.getFullYear();
  const entryMonth = entryDate.getMonth() + 1;
  const closedMonth = await prisma.closedMonth.findUnique({
    where: { year_month: { year: entryYear, month: entryMonth } },
  });
  if (closedMonth) {
    return NextResponse.json(
      { error: 'Месяц закрыт — новые записи недопустимы. Сначала откройте месяц в разделе «Закрытие месяца»' },
      { status: 423 }
    );
  }

  if (employeeId) {
    const shiftError = await validateShiftEmployeeType(Number(employeeId), shiftType || null);
    if (shiftError) return NextResponse.json({ error: shiftError }, { status: 400 });

    const duplicateError = await validateUniqueShift(Number(employeeId), new Date(date), shiftType || null);
    if (duplicateError) return NextResponse.json({ error: duplicateError }, { status: 409 });

    const attendanceError = await validateNoAttendanceOnDate(Number(employeeId), new Date(date), shiftType || null);
    if (attendanceError) return NextResponse.json({ error: attendanceError }, { status: 409 });
  }

  // Менеджер может писать только в свои аптеки
  if (role === 'manager') {
    const allowedIds = await getManagerPharmacyIds(request);
    if (!allowedIds || !allowedIds.includes(Number(pharmacyId))) {
      return NextResponse.json({ error: 'Нет доступа к этой аптеке' }, { status: 403 });
    }
  }

  const items: { amount: string; category?: string; comment?: string; employeeId?: number | null }[] =
    Array.isArray(expenseItems)
      ? expenseItems.filter((i) => parseFloat(i.amount) > 0)
      : [];

  // Авансы и доплаты привязываются к конкретному сотруднику (может отличаться от employeeId
  // записи). Проверяем, что выбранный сотрудник действительно работает в этой аптеке.
  const RECIPIENT_CATEGORIES = new Set(['employeeAdvance', 'employeeSurcharge']);
  const recipientEmployeeIds = [
    ...new Set(
      items
        .filter((i) => i.category && RECIPIENT_CATEGORIES.has(i.category) && i.employeeId)
        .map((i) => Number(i.employeeId))
    ),
  ];
  if (recipientEmployeeIds.length > 0) {
    const links = await prisma.employeePharmacy.findMany({
      where: { employeeId: { in: recipientEmployeeIds }, pharmacyId: Number(pharmacyId) },
      select: { employeeId: true },
    });
    const linkedIds = new Set(links.map((l) => l.employeeId));
    if (recipientEmployeeIds.some((id) => !linkedIds.has(id))) {
      return NextResponse.json(
        { error: 'Аванс/доплату можно записать только сотруднику выбранной аптеки' },
        { status: 400 }
      );
    }
  }

  const totalExpenses = items
    .reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0)
    .toFixed(2);

  const expenseComment =
    items.length > 0
      ? items
          .map((i) => {
            const categoryLabel = i.category ? monthlyFieldLabel(i.category) : null;
            const desc = [categoryLabel, i.comment].filter(Boolean).join(': ');
            return desc
              ? `${parseFloat(i.amount).toLocaleString('ru-RU')} — ${desc}`
              : parseFloat(i.amount).toLocaleString('ru-RU');
          })
          .join('; ')
      : null;

  // Менеджер создаёт записи со статусом pending; admin/bookkeeper — сразу approved
  const entryStatus = role === 'manager' ? 'pending' : 'approved';

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyRevenueEntry.create({
      data: {
        pharmacyId: Number(pharmacyId),
        date: entryDate,
        cashRevenue: String(cashRevenue || 0),
        terminalRevenue: String(terminalRevenue || 0),
        kaspiRevenue: String(kaspiRevenue || 0),
        bonusRevenue: String(bonusRevenue || 0),
        additionalExpenses: totalExpenses,
        expenseComment,
        generalComment: generalComment || null,
        employeeName: employeeName.trim(),
        employeeId: employeeId ? Number(employeeId) : null,
        shiftType: shiftType || null,
        status: entryStatus,
        submittedById: userId,
        ...(entryStatus === 'approved' ? { approvedAt: new Date() } : {}),
      },
    });

    if (items.length > 0) {
      await tx.dailyExpenseItem.createMany({
        data: items.map((i) => ({
          entryId: created.id,
          amount: i.amount,
          category: i.category || null,
          comment: i.comment || null,
          employeeId: i.category && RECIPIENT_CATEGORIES.has(i.category) && i.employeeId ? Number(i.employeeId) : null,
        })),
      });
    }

    return tx.dailyRevenueEntry.findUnique({
      where: { id: created.id },
      include: { pharmacy: true, expenseItems: { orderBy: { id: 'asc' } } },
    });
  });

  return NextResponse.json(serializeEntry(entry as unknown as Record<string, unknown>), { status: 201 });
}
