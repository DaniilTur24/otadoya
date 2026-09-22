import { monthlyFieldType } from '@/lib/monthly-report-fields';

export interface SummaryExpenseItem {
  category: string | null;
  amount: number;
}

export interface SummaryEntry {
  date: string;
  status: string;
  excludedFromReport: boolean;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
  totalRevenue: number;
  expenseItems: SummaryExpenseItem[];
}

// Что реально считается деньгами: отклонённая запись недействительна (статус легаси —
// кнопка «Отклонить» убрана, новых не будет), excludedFromReport — бухгалтер вычеркнул
// запись как ошибочную/дубль. «На проверке» в счёт идёт: деньги из кассы уже вышли,
// подтверждение — это workflow-шлюз, а не факт о том, было ли движение денег (QA раунд 4, №3
// расширен: под раздачу правильно попадают rejected/excludedFromReport, но не pending).
export function countsTowardsTotals(e: Pick<SummaryEntry, 'status' | 'excludedFromReport'>): boolean {
  return e.status !== 'rejected' && !e.excludedFromReport;
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

export function summarizeEntries(all: SummaryEntry[]) {
  const list = all.filter(countsTowardsTotals);
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

// Группирует по дню И по аптеке — так, в отличие от группировки только по дате, за
// одной свёрнутой строкой всегда стоит одна аптека. Если в день были записи по
// нескольким аптекам, получаем несколько строк с одинаковой датой вместо одной строки
// со смешанными «2 аптеки», под которой цифры было не понять, пока не развернёшь.
// Использует Map (а не «подряд идущие записи»), поэтому не зависит от того, идут ли
// записи одной аптеки подряд в исходном списке.
export function groupEntriesByDateAndPharmacy<T extends { date: string; pharmacy: { id: number; name: string } }>(
  list: T[]
) {
  const groups: { key: string; dateKey: string; pharmacyId: number; pharmacyName: string; entries: T[] }[] = [];
  const indexByKey = new Map<string, number>();
  for (const entry of list) {
    const dateKey = entry.date.slice(0, 10);
    const key = `${dateKey}:${entry.pharmacy.id}`;
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
      groups[idx].entries.push(entry);
    } else {
      indexByKey.set(key, groups.length);
      groups.push({ key, dateKey, pharmacyId: entry.pharmacy.id, pharmacyName: entry.pharmacy.name, entries: [entry] });
    }
  }
  return groups;
}
