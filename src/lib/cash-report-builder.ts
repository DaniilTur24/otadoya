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

export interface CashReportRow {
  entryId: number;
  date: string; // YYYY-MM-DD
  employeeName: string;
  status: string;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
  expenseLines: CashReportExpenseLine[];
  cashExpensesTotal: number;
  cashNet: number;
}

export interface CashReportPharmacySection {
  pharmacyId: number;
  pharmacyName: string;
  rows: CashReportRow[];
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

export function buildCashReportRow(entry: CashReportSourceEntry): CashReportRow {
  const expenseLines: CashReportExpenseLine[] = entry.expenseItems.map((item) => ({
    category: item.category,
    categoryLabel: categoryLabel(item.category),
    amount: item.amount,
    comment: item.comment,
    recipientName: item.employee?.name ?? null,
    affectsCash: !EXCLUDED_FROM_CASH.has(item.category ?? ''),
  }));

  const cashExpensesTotal = expenseLines
    .filter((l) => l.affectsCash)
    .reduce((sum, l) => sum + l.amount, 0);

  return {
    entryId: entry.id,
    date: toDateKey(entry.date),
    employeeName: entry.employeeName,
    status: entry.status,
    cashRevenue: entry.cashRevenue,
    terminalRevenue: entry.terminalRevenue,
    kaspiRevenue: entry.kaspiRevenue,
    expenseLines,
    cashExpensesTotal,
    cashNet: entry.cashRevenue - cashExpensesTotal,
  };
}

export function buildCashReport(entries: CashReportSourceEntry[]): CashReportPharmacySection[] {
  const byPharmacy = new Map<number, CashReportPharmacySection>();

  const sorted = [...entries].sort((a, b) => toDateKey(a.date).localeCompare(toDateKey(b.date)) || a.id - b.id);

  for (const entry of sorted) {
    let section = byPharmacy.get(entry.pharmacy.id);
    if (!section) {
      section = {
        pharmacyId: entry.pharmacy.id,
        pharmacyName: entry.pharmacy.name,
        rows: [],
        totalCashRevenue: 0,
        totalCashExpenses: 0,
        totalCashNet: 0,
      };
      byPharmacy.set(entry.pharmacy.id, section);
    }

    const row = buildCashReportRow(entry);
    section.rows.push(row);
    section.totalCashRevenue += row.cashRevenue;
    section.totalCashExpenses += row.cashExpensesTotal;
    section.totalCashNet += row.cashNet;
  }

  return [...byPharmacy.values()].sort((a, b) => a.pharmacyName.localeCompare(b.pharmacyName, 'ru'));
}
