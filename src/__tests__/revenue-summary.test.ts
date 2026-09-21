import { describe, it, expect } from 'vitest';
import { summarizeEntries, groupEntriesByDate, type SummaryEntry } from '@/lib/revenue-summary';

function entry(over: Partial<SummaryEntry> = {}): SummaryEntry {
  const cashRevenue = over.cashRevenue ?? 0;
  const terminalRevenue = over.terminalRevenue ?? 0;
  const kaspiRevenue = over.kaspiRevenue ?? 0;
  return {
    date: '2026-09-01',
    cashRevenue,
    terminalRevenue,
    kaspiRevenue,
    totalRevenue: cashRevenue + terminalRevenue + kaspiRevenue,
    expenseItems: [],
    ...over,
  };
}

describe('summarizeEntries', () => {
  it('складывает выручку по способам оплаты', () => {
    const s = summarizeEntries([
      entry({ cashRevenue: 100_000, terminalRevenue: 500_000 }),
      entry({ cashRevenue: 47_155, terminalRevenue: 5_214 }),
    ]);

    expect(s.totalCash).toBe(147_155);
    expect(s.totalTerminal).toBe(505_214);
    expect(s.totalRevenue).toBe(652_369);
  });

  it('разносит бонусы, зарплаты и доплаты по своим колонкам, не задваивая их в расходах', () => {
    const s = summarizeEntries([
      entry({
        cashRevenue: 100_000,
        expenseItems: [
          { category: 'pharmaBonus', amount: 5_000 },
          { category: 'employeeAdvance', amount: 15_000 },
          { category: 'employeeSurcharge', amount: 5_000 },
          { category: 'utilities', amount: 3_000 },
        ],
      }),
    ]);

    expect(s.totalBonuses).toBe(5_000);
    expect(s.totalAdvances).toBe(15_000);
    expect(s.totalSurcharges).toBe(5_000);
    expect(s.totalExpenses).toBe(3_000);
  });

  it('не вычитает доплату из наличных — она не выдаётся из кассы', () => {
    const s = summarizeEntries([
      entry({
        cashRevenue: 140_000,
        expenseItems: [
          { category: 'pharmaBonus', amount: 5_000 },
          { category: 'employeeAdvance', amount: 15_000 },
          { category: 'employeeSurcharge', amount: 5_000 },
        ],
      }),
    ]);

    expect(s.cashNet).toBe(120_000);
    expect(s.total).toBe(115_000);
  });

  it('уводит день в минус, когда из кассы выдали больше, чем заработали', () => {
    const s = summarizeEntries([
      entry({
        cashRevenue: 4_555,
        terminalRevenue: 4_444,
        expenseItems: [
          { category: 'pharmaBonus', amount: 5_000 },
          { category: 'employeeAdvance', amount: 8_000 },
          { category: 'employeeSurcharge', amount: 4_000 },
        ],
      }),
    ]);

    expect(s.cashNet).toBe(-8_445);
    expect(s.total).toBe(-8_001);
  });

  it('прибавляет доходные статьи к итогу, а не вычитает', () => {
    const withIncome = summarizeEntries([
      entry({ cashRevenue: 10_000, expenseItems: [{ category: 'retailRevenue', amount: 2_000 }] }),
    ]);

    expect(withIncome.totalIncomes).toBe(2_000);
    expect(withIncome.totalExpenses).toBe(0);
    expect(withIncome.total).toBe(12_000);
  });

  it('на пустом списке даёт нули, а не NaN', () => {
    const s = summarizeEntries([]);
    expect(s.totalRevenue).toBe(0);
    expect(s.cashNet).toBe(0);
    expect(s.total).toBe(0);
  });
});

describe('groupEntriesByDate', () => {
  it('собирает подряд идущие записи одного дня в одну группу, сохраняя порядок', () => {
    const groups = groupEntriesByDate([
      entry({ date: '2026-09-03', cashRevenue: 100_000 }),
      entry({ date: '2026-09-03', cashRevenue: 47_155 }),
      entry({ date: '2026-09-02', cashRevenue: 40_000 }),
    ]);

    expect(groups.map((g) => g.dateKey)).toEqual(['2026-09-03', '2026-09-02']);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].entries).toHaveLength(1);
  });

  it('игнорирует время в дате и группирует по календарному дню', () => {
    const groups = groupEntriesByDate([
      entry({ date: '2026-09-03T00:00:00.000Z' }),
      entry({ date: '2026-09-03T21:51:00.000Z' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe('2026-09-03');
  });

  it('на пустом списке не создаёт групп', () => {
    expect(groupEntriesByDate([])).toEqual([]);
  });
});
