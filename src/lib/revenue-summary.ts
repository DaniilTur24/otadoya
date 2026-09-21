import { monthlyFieldType } from '@/lib/monthly-report-fields';

export interface SummaryExpenseItem {
  category: string | null;
  amount: number;
}

export interface SummaryEntry {
  date: string;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
  totalRevenue: number;
  expenseItems: SummaryExpenseItem[];
}

// Бонусы, зарплаты и доплаты показываются отдельными колонками, поэтому из общих
// сумм доходов/расходов они исключаются, чтобы не посчитаться дважды.
export const EXCLUDED_FROM_GENERIC_SUMS = new Set(['pharmaBonus', 'employeeAdvance', 'employeeSurcharge']);

export function pharmaBonusSum(items: SummaryExpenseItem[]) {
  return items.filter((i) => i.category === 'pharmaBonus').reduce((s, i) => s + i.amount, 0);
}
export function advanceSum(items: SummaryExpenseItem[]) {
  return items.filter((i) => i.category === 'employeeAdvance').reduce((s, i) => s + i.amount, 0);
}
export function surchargeSum(items: SummaryExpenseItem[]) {
  return items.filter((i) => i.category === 'employeeSurcharge').reduce((s, i) => s + i.amount, 0);
}

// Статьи с rowType 'income' — доходные, прибавляются к выручке
export function incomeItemsSum(items: SummaryExpenseItem[]) {
  return items
    .filter((i) => !EXCLUDED_FROM_GENERIC_SUMS.has(i.category ?? '') && monthlyFieldType(i.category) === 'income')
    .reduce((s, i) => s + i.amount, 0);
}
// Остальные статьи (expense / neutral) — расходы
export function expenseItemsSum(items: SummaryExpenseItem[]) {
  return items
    .filter((i) => !EXCLUDED_FROM_GENERIC_SUMS.has(i.category ?? '') && monthlyFieldType(i.category) !== 'income')
    .reduce((s, i) => s + i.amount, 0);
}

export function summarizeEntries(list: SummaryEntry[]) {
  const totalRevenue    = list.reduce((s, e) => s + e.totalRevenue, 0);
  const totalCash       = list.reduce((s, e) => s + e.cashRevenue, 0);
  const totalTerminal   = list.reduce((s, e) => s + e.terminalRevenue, 0);
  const totalKaspi      = list.reduce((s, e) => s + e.kaspiRevenue, 0);
  const totalIncomes    = list.reduce((s, e) => s + incomeItemsSum(e.expenseItems), 0);
  const totalBonuses    = list.reduce((s, e) => s + pharmaBonusSum(e.expenseItems), 0);
  const totalAdvances   = list.reduce((s, e) => s + advanceSum(e.expenseItems), 0);
  const totalSurcharges = list.reduce((s, e) => s + surchargeSum(e.expenseItems), 0);
  const totalExpenses   = list.reduce((s, e) => s + expenseItemsSum(e.expenseItems), 0);

  // Доплата (employeeSurcharge) не выдаётся из кассы наличными, поэтому остаток на руках
  // её не уменьшает — та же логика, что в src/lib/cash-report-builder.ts.
  const cashNet = totalCash - totalBonuses - totalAdvances - totalExpenses;
  const total = totalRevenue + totalIncomes - totalExpenses - totalBonuses - totalAdvances - totalSurcharges;

  return {
    totalRevenue, totalCash, totalTerminal, totalKaspi, totalIncomes,
    totalBonuses, totalAdvances, totalSurcharges, totalExpenses, total, cashNet,
  };
}

// Записи приходят с сервера отсортированными по дате (desc), поэтому один день — это
// подряд идущие строки; группировка сохраняет исходный порядок таблицы.
export function groupEntriesByDate<T extends { date: string }>(list: T[]) {
  const groups: { dateKey: string; entries: T[] }[] = [];
  for (const entry of list) {
    const dateKey = entry.date.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dateKey) last.entries.push(entry);
    else groups.push({ dateKey, entries: [entry] });
  }
  return groups;
}
