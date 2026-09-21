import { prisma } from '@/lib/prisma';
import { computeCashBalances, CashDayActivity, CashDayBalance } from '@/lib/cash-balance';
import { summarizeEntries } from '@/lib/revenue-summary';

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Читает из базы всё, что влияет на кассу аптеки, и считает остаток по дням.
 *
 * Используется и страницей выручки, и выгрузкой в Excel: расчёт должен быть один,
 * иначе экран и файл начнут показывать разные числа.
 */
export async function loadCashBalance(pharmacyId: number, from?: string, to?: string) {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { id: true, cashOpeningDate: true },
  });

  // Без месяца старта считать не от чего: брать всю историю нельзя — за прошлые месяцы
  // инкассации не вносились, и остаток вырос бы на всю выручку за всё время.
  if (!pharmacy?.cashOpeningDate) return null;

  const openingDate = toDateKey(pharmacy.cashOpeningDate);
  const dateRange = {
    gte: pharmacy.cashOpeningDate,
    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  };

  // Отклонённые смены в кассу не идут: запись признана недействительной. То же — записи,
  // которые бухгалтер вычеркнул как ошибочные/дубли (excludedFromReport). Ожидающие
  // проверки — идут, деньги из ящика уже вышли независимо от статуса подтверждения.
  const entries = await prisma.dailyRevenueEntry.findMany({
    where: { pharmacyId, status: { not: 'rejected' }, excludedFromReport: false, date: dateRange },
    include: { expenseItems: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const activity: CashDayActivity[] = entries.map((entry) => {
    const summary = summarizeEntries([
      {
        date: toDateKey(entry.date),
        status: entry.status,
        excludedFromReport: entry.excludedFromReport,
        cashRevenue: Number(entry.cashRevenue),
        terminalRevenue: Number(entry.terminalRevenue),
        kaspiRevenue: Number(entry.kaspiRevenue ?? 0),
        totalRevenue: 0,
        expenseItems: entry.expenseItems.map((i) => ({ category: i.category, amount: Number(i.amount) })),
      },
    ]);

    const cashRevenue = summary.totalCash;
    const cashExpenses = summary.totalBonuses + summary.totalAdvances + summary.totalExpenses;
    const isPending = entry.status === 'pending';

    return {
      date: toDateKey(entry.date),
      cashRevenue,
      cashExpenses,
      pendingCashRevenue: isPending ? cashRevenue : 0,
      pendingCashExpenses: isPending ? cashExpenses : 0,
    };
  });

  const movementRows = await prisma.cashMovement.findMany({
    where: { pharmacyId, date: dateRange },
    orderBy: [{ date: 'asc' }],
  });

  const { openingBalance, days } = computeCashBalances({
    openingDate,
    activity,
    movements: movementRows.map((m) => ({ date: toDateKey(m.date), amount: Number(m.amount) })),
    from,
    to,
  });

  return { openingDate, openingBalance, days, movementRows };
}

export type LoadedCashBalance = NonNullable<Awaited<ReturnType<typeof loadCashBalance>>>;
export type { CashDayBalance };
