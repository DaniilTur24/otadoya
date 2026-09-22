import { monthlyFieldLabel } from '@/lib/monthly-report-fields';

// Категории, не входящие в MONTHLY_REPORT_ROWS — своя подпись, как в src/app/revenue/page.tsx
const SPECIAL_CATEGORY_LABELS: Record<string, string> = {
  employeeAdvance: 'Зарплата',
  employeeSurcharge: 'Доплата',
};

function categoryLabel(category: string | null): string {
  if (!category) return 'Прочее';
  return SPECIAL_CATEGORY_LABELS[category] ?? monthlyFieldLabel(category);
}

// Доплата (employeeSurcharge) не выдаётся из кассы наличными — не уменьшает остаток на руках.
// Логика зеркалит cashNet в src/app/revenue/page.tsx (summarizeEntries).
const EXCLUDED_FROM_CASH = new Set(['employeeSurcharge']);

export interface CashReportExpenseLine {
  category: string | null;
  categoryLabel: string;
  amount: number;
  comment: string | null;
  recipientName: string | null;
  affectsCash: boolean;
}

/** Остаток кассы за день — тот же, что на странице выручки. Отсутствует, если у аптеки не задан месяц старта. */
export interface CashReportDayBalance {
  openingBalance: number;
  deposit: number;
  closingBalance: number;
}

export interface CashReportDay {
  date: string; // YYYY-MM-DD
  employeeNames: string[]; // все сотрудники, у кого были смены в этот день (одна смена = одно имя)
  statuses: string[]; // статусы записей дня (обычно один; несколько — если смешаны approved/pending)
  cashRevenue: number; // сумма нал. выручки всех смен дня
  expenseLines: CashReportExpenseLine[]; // расходы всех смен дня, построчно, в порядке записей
  cashExpensesTotal: number;
  cashNet: number;
  balance?: CashReportDayBalance;
}

export interface CashReportPharmacySection {
  pharmacyId: number;
  pharmacyName: string;
  days: CashReportDay[];
  totalCashRevenue: number;
  totalCashExpenses: number;
  totalCashNet: number;
}

export interface CashReportSourceEntry {
  id: number;
  date: string | Date;
  status: string;
  employeeName: string;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
  pharmacy: { id: number; name: string };
  expenseItems: {
    category: string | null;
    amount: number;
    comment: string | null;
    employee: { name: string } | null;
  }[];
}

function toDateKey(date: string | Date): string {
  return typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

function buildExpenseLines(entry: CashReportSourceEntry): CashReportExpenseLine[] {
  return entry.expenseItems.map((item) => ({
    category: item.category,
    categoryLabel: categoryLabel(item.category),
    amount: item.amount,
    comment: item.comment,
    recipientName: item.employee?.name ?? null,
    affectsCash: !EXCLUDED_FROM_CASH.has(item.category ?? ''),
  }));
}

// Несколько смен/записей за один календарный день (по одной аптеке) сводятся в один день —
// бухгалтер сверяет кассу за день целиком, а не по отдельности за каждую смену.
export function buildCashReportDay(entries: CashReportSourceEntry[]): CashReportDay {
  const sorted = [...entries].sort((a, b) => a.id - b.id);

  const employeeNames = [...new Set(sorted.map((e) => e.employeeName))];
  const statuses = [...new Set(sorted.map((e) => e.status))];
  const cashRevenue = sorted.reduce((sum, e) => sum + e.cashRevenue, 0);
  const expenseLines = sorted.flatMap(buildExpenseLines);
  const cashExpensesTotal = expenseLines.filter((l) => l.affectsCash).reduce((sum, l) => sum + l.amount, 0);

  return {
    date: toDateKey(sorted[0].date),
    employeeNames,
    statuses,
    cashRevenue,
    expenseLines,
    cashExpensesTotal,
    cashNet: cashRevenue - cashExpensesTotal,
  };
}

export function buildCashReport(
  entries: CashReportSourceEntry[],
  /** Остатки по аптекам: pharmacyId → (дата → остаток). Аптеки без месяца старта сюда не попадают. */
  balances?: Map<number, Map<string, CashReportDayBalance>>
): CashReportPharmacySection[] {
  const byPharmacy = new Map<number, { pharmacyName: string; byDate: Map<string, CashReportSourceEntry[]> }>();

  for (const entry of entries) {
    let pharmacyGroup = byPharmacy.get(entry.pharmacy.id);
    if (!pharmacyGroup) {
      pharmacyGroup = { pharmacyName: entry.pharmacy.name, byDate: new Map() };
      byPharmacy.set(entry.pharmacy.id, pharmacyGroup);
    }
    const dateKey = toDateKey(entry.date);
    const dayEntries = pharmacyGroup.byDate.get(dateKey) ?? [];
    dayEntries.push(entry);
    pharmacyGroup.byDate.set(dateKey, dayEntries);
  }

  const sections: CashReportPharmacySection[] = [...byPharmacy.entries()].map(([pharmacyId, group]) => {
    const pharmacyBalances = balances?.get(pharmacyId);
    const days = [...group.byDate.entries()]
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([dateKey, dayEntries]) => {
        const day = buildCashReportDay(dayEntries);
        const balance = pharmacyBalances?.get(dateKey);
        return balance ? { ...day, balance } : day;
      });

    return {
      pharmacyId,
      pharmacyName: group.pharmacyName,
      days,
      totalCashRevenue: days.reduce((sum, d) => sum + d.cashRevenue, 0),
      totalCashExpenses: days.reduce((sum, d) => sum + d.cashExpensesTotal, 0),
      totalCashNet: days.reduce((sum, d) => sum + d.cashNet, 0),
    };
  });

  return sections.sort((a, b) => a.pharmacyName.localeCompare(b.pharmacyName, 'ru'));
}
