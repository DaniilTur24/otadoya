import { describe, it, expect } from 'vitest';
import { buildCashReport, buildCashReportRow, CashReportSourceEntry } from '@/lib/cash-report-builder';

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

describe('buildCashReportRow', () => {
  it('subtracts cash-affecting expense categories from cash revenue', () => {
    const row = buildCashReportRow(
      entry({
        cashRevenue: 279580,
        expenseItems: [
          { category: 'pharmaBonus', amount: 7205, comment: null, employee: null },
          { category: 'employeeAdvance', amount: 18620, comment: null, employee: { name: 'Петров' } },
          { category: 'otherExpenses', amount: 14900, comment: 'инкассация', employee: null },
        ],
      })
    );

    expect(row.cashExpensesTotal).toBe(40725);
    expect(row.cashNet).toBe(279580 - 40725);
  });

  it('does not let employeeSurcharge (доплата) reduce cash on hand', () => {
    const row = buildCashReportRow(
      entry({
        cashRevenue: 100000,
        expenseItems: [
          { category: 'employeeSurcharge', amount: 5000, comment: null, employee: { name: 'Сидоров' } },
        ],
      })
    );

    expect(row.cashExpensesTotal).toBe(0);
    expect(row.cashNet).toBe(100000);
    expect(row.expenseLines[0].affectsCash).toBe(false);
  });

  it('labels employeeAdvance and employeeSurcharge like the revenue page does', () => {
    const row = buildCashReportRow(
      entry({
        expenseItems: [
          { category: 'employeeAdvance', amount: 1000, comment: null, employee: { name: 'Иван' } },
          { category: 'employeeSurcharge', amount: 500, comment: null, employee: { name: 'Иван' } },
        ],
      })
    );

    expect(row.expenseLines[0].categoryLabel).toBe('Зарплата');
    expect(row.expenseLines[1].categoryLabel).toBe('Доплата');
  });
});

describe('buildCashReport', () => {
  it('groups entries by pharmacy and sums totals', () => {
    const sections = buildCashReport([
      entry({ id: 1, pharmacy: { id: 1, name: 'Думан' }, cashRevenue: 100000 }),
      entry({ id: 2, pharmacy: { id: 1, name: 'Думан' }, cashRevenue: 50000 }),
      entry({ id: 3, pharmacy: { id: 2, name: 'Береке' }, cashRevenue: 30000 }),
    ]);

    expect(sections).toHaveLength(2);
    const duman = sections.find((s) => s.pharmacyName === 'Думан')!;
    expect(duman.rows).toHaveLength(2);
    expect(duman.totalCashRevenue).toBe(150000);
    expect(duman.totalCashNet).toBe(150000);
  });

  it('sorts rows by date within a pharmacy', () => {
    const sections = buildCashReport([
      entry({ id: 1, date: '2026-09-05', pharmacy: { id: 1, name: 'Думан' } }),
      entry({ id: 2, date: '2026-09-01', pharmacy: { id: 1, name: 'Думан' } }),
    ]);

    expect(sections[0].rows.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-05']);
  });

  it('returns an empty list for no entries', () => {
    expect(buildCashReport([])).toEqual([]);
  });
});
