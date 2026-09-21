import { describe, it, expect } from 'vitest';
import { buildCashReport, buildCashReportDay, CashReportSourceEntry } from '@/lib/cash-report-builder';

function entry(overrides: Partial<CashReportSourceEntry>): CashReportSourceEntry {
  return {
    id: 1,
    date: '2026-09-05',
    status: 'approved',
    employeeName: 'Иванова',
    cashRevenue: 100000,
    terminalRevenue: 0,
    kaspiRevenue: 0,
    pharmacy: { id: 1, name: 'Думан' },
    expenseItems: [],
    ...overrides,
  };
}

describe('buildCashReportDay', () => {
  it('merges two shifts of the same day into one day total', () => {
    const day = buildCashReportDay([
      entry({ id: 1, employeeName: 'etel', cashRevenue: 100000, expenseItems: [] }),
      entry({
        id: 2,
        employeeName: 'etel',
        cashRevenue: 40000,
        expenseItems: [
          { category: 'pharmaBonus', amount: 5000, comment: null, employee: null },
          { category: 'employeeAdvance', amount: 15000, comment: null, employee: { name: 'Кобзарь' } },
          { category: 'employeeSurcharge', amount: 5000, comment: null, employee: { name: 'etel' } },
        ],
      }),
    ]);

    expect(day.cashRevenue).toBe(140000);
    expect(day.cashExpensesTotal).toBe(20000);
    expect(day.cashNet).toBe(120000);
    expect(day.expenseLines).toHaveLength(3);
  });

  it('does not let employeeSurcharge (доплата) reduce cash on hand', () => {
    const day = buildCashReportDay([
      entry({
        cashRevenue: 100000,
        expenseItems: [
          { category: 'employeeSurcharge', amount: 5000, comment: null, employee: { name: 'Сидоров' } },
        ],
      }),
    ]);

    expect(day.cashExpensesTotal).toBe(0);
    expect(day.cashNet).toBe(100000);
    expect(day.expenseLines[0].affectsCash).toBe(false);
  });

  it('labels employeeAdvance and employeeSurcharge like the revenue page does', () => {
    const day = buildCashReportDay([
      entry({
        expenseItems: [
          { category: 'employeeAdvance', amount: 1000, comment: null, employee: { name: 'Иван' } },
          { category: 'employeeSurcharge', amount: 500, comment: null, employee: { name: 'Иван' } },
        ],
      }),
    ]);

    expect(day.expenseLines[0].categoryLabel).toBe('Зарплата');
    expect(day.expenseLines[1].categoryLabel).toBe('Доплата');
  });

  it('collects distinct employee names and statuses across merged shifts', () => {
    const day = buildCashReportDay([
      entry({ id: 1, employeeName: 'etel', status: 'approved' }),
      entry({ id: 2, employeeName: 'sanya', status: 'pending' }),
    ]);

    expect(day.employeeNames).toEqual(['etel', 'sanya']);
    expect(day.statuses).toEqual(['approved', 'pending']);
  });
});

describe('buildCashReport', () => {
  it('groups entries by pharmacy and by calendar day, and sums period totals', () => {
    const sections = buildCashReport([
      entry({ id: 1, date: '2026-09-05', pharmacy: { id: 1, name: 'Думан' }, cashRevenue: 100000 }),
      entry({ id: 2, date: '2026-09-05', pharmacy: { id: 1, name: 'Думан' }, cashRevenue: 50000 }),
      entry({ id: 3, date: '2026-09-06', pharmacy: { id: 1, name: 'Думан' }, cashRevenue: 30000 }),
      entry({ id: 4, date: '2026-09-05', pharmacy: { id: 2, name: 'Береке' }, cashRevenue: 20000 }),
    ]);

    expect(sections).toHaveLength(2);
    const duman = sections.find((s) => s.pharmacyName === 'Думан')!;
    expect(duman.days).toHaveLength(2);
    expect(duman.days[0].cashRevenue).toBe(150000);
    expect(duman.days[1].cashRevenue).toBe(30000);
    expect(duman.totalCashRevenue).toBe(180000);
    expect(duman.totalCashNet).toBe(180000);
  });

  it('sorts days chronologically within a pharmacy', () => {
    const sections = buildCashReport([
      entry({ id: 1, date: '2026-09-05', pharmacy: { id: 1, name: 'Думан' } }),
      entry({ id: 2, date: '2026-09-01', pharmacy: { id: 1, name: 'Думан' } }),
    ]);

    expect(sections[0].days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-05']);
  });

  it('attaches the running cash balance to the matching day', () => {
    const balances = new Map([
      [1, new Map([['2026-09-05', { openingBalance: 20_000, deposit: 90_000, closingBalance: 30_000 }]])],
    ]);
    const [section] = buildCashReport([entry({ date: '2026-09-05' })], balances);

    expect(section.days[0].balance).toEqual({ openingBalance: 20_000, deposit: 90_000, closingBalance: 30_000 });
  });

  it('leaves the balance out for a pharmacy without a start month', () => {
    const [section] = buildCashReport([entry({ date: '2026-09-05' })], new Map());
    expect(section.days[0].balance).toBeUndefined();
  });

  it('returns an empty list for no entries', () => {
    expect(buildCashReport([])).toEqual([]);
  });
});
