import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pharmacy: { findMany: vi.fn() },
    dailyRevenueEntry: { findMany: vi.fn() },
    extractedExpenseEntry: { findMany: vi.fn() },
    importedReportValue: { findMany: vi.fn() },
    monthlyReportOverride: { findMany: vi.fn() },
    pharmacyPdfReport: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { computeMonthlyData } from '@/lib/monthly-report-builder';

// ─── helpers ─────────────────────────────────────────────────────────────────

type Pharmacy = { id: number; name: string; coefficient: number; terminalRent: number; procedureRent: number; isActive: boolean };

function mockPharmacies(pharmacies: Pharmacy[]) {
  vi.mocked(prisma.pharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(pharmacies);
}

/** dailyRevenueEntry.findMany is called twice: once for revenue/expenseItems, once for shift salaries. */
function mockRevenueEntries(revenueEntries: unknown[], shiftEntries: unknown[] = []) {
  vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { include?: { expenseItems?: boolean; employee?: unknown } }) => {
      if (args?.include?.employee) return Promise.resolve(shiftEntries);
      return Promise.resolve(revenueEntries);
    }
  );
}

function mockExtractedExpenses(entries: unknown[] = []) {
  vi.mocked(prisma.extractedExpenseEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
}

function mockImportedValues(values: unknown[] = []) {
  vi.mocked(prisma.importedReportValue.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(values);
}

function mockOverrides(overrides: unknown[] = []) {
  vi.mocked(prisma.monthlyReportOverride.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(overrides);
}

function mockPdfReports(reports: unknown[] = []) {
  vi.mocked(prisma.pharmacyPdfReport.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(reports);
}

const pharmacy1: Pharmacy = { id: 1, name: 'Аптека №1', coefficient: 0, terminalRent: 0, procedureRent: 0, isActive: true };

beforeEach(() => {
  mockExtractedExpenses();
  mockImportedValues();
  mockOverrides();
  mockPdfReports();
});

// ─── computeMonthlyData ───────────────────────────────────────────────────────

describe('computeMonthlyData', () => {
  it('returns empty systemData when there are no pharmacies', async () => {
    mockPharmacies([]);
    mockRevenueEntries([]);

    const { pharmacies, systemData } = await computeMonthlyData(2026, 6);

    expect(pharmacies).toEqual([]);
    expect(systemData).toEqual({});
  });

  it('zero-fills a pharmacy with no entries', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].retailRevenue).toBe(0);
    expect(systemData[1].totalExpenses).toBe(0);
    expect(systemData[1].netIncome).toBe(0);
  });

  it('aggregates cash/terminal/kaspi revenue from approved entries', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([
      { pharmacyId: 1, cashRevenue: 10000, terminalRevenue: 5000, kaspiRevenue: 2000, expenseItems: [] },
      { pharmacyId: 1, cashRevenue: 3000, terminalRevenue: 0, kaspiRevenue: 0, expenseItems: [] },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].retailRevenue).toBe(20000);
    expect(systemData[1].kaspiRevenue).toBe(2000);
  });

  it('skips revenue entries for pharmacies not in the active list', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([
      { pharmacyId: 999, cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0, expenseItems: [] },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].retailRevenue).toBe(0);
    expect(systemData[999]).toBeUndefined();
  });

  it('adds expense items into the matching category', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([
      {
        pharmacyId: 1,
        cashRevenue: 0,
        terminalRevenue: 0,
        kaspiRevenue: 0,
        expenseItems: [{ category: 'rentExpenses', amount: 15000 }],
      },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].rentExpenses).toBe(15000);
    expect(systemData[1].otherExpenses).toBe(0);
  });

  it('falls back to otherExpenses for an unrecognized category', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([
      {
        pharmacyId: 1,
        cashRevenue: 0,
        terminalRevenue: 0,
        kaspiRevenue: 0,
        expenseItems: [{ category: 'somethingUnknown', amount: 777 }],
      },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].otherExpenses).toBe(777);
  });

  it('computes pharmaSalary from day and full_day shifts (baseSalary/15 and baseSalary/10)', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries(
      [],
      [
        { pharmacyId: 1, shiftType: 'day', employee: { baseSalary: 150000 } },
        { pharmacyId: 1, shiftType: 'full_day', employee: { baseSalary: 150000 } },
      ]
    );

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].pharmaSalary).toBeCloseTo(150000 / 15 + 150000 / 10, 5);
  });

  it('computes wholesaleRevenue as retailRevenue / coefficient when coefficient > 0', async () => {
    mockPharmacies([{ ...pharmacy1, coefficient: 2 }]);
    mockRevenueEntries([
      { pharmacyId: 1, cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0, expenseItems: [] },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].wholesaleRevenue).toBe(100000);
  });

  it('leaves wholesaleRevenue at 0 when coefficient is 0 (no division by zero)', async () => {
    mockPharmacies([{ ...pharmacy1, coefficient: 0 }]);
    mockRevenueEntries([
      { pharmacyId: 1, cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0, expenseItems: [] },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].wholesaleRevenue).toBe(0);
    expect(Number.isFinite(systemData[1].wholesaleRevenue)).toBe(true);
  });

  it('maps ExtractedExpenseEntry categories to rentExpenses and bankServices', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockExtractedExpenses([
      { pharmacyId: 1, category: 'rent', amount: 50000 },
      { pharmacyId: 1, category: 'expense', amount: 3000 },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].rentExpenses).toBe(50000);
    expect(systemData[1].bankServices).toBe(3000);
  });

  it('adds approved ImportedReportValue amounts to the matching field', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockImportedValues([{ pharmacyId: 1, fieldKey: 'utilities', amount: 12000 }]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].utilities).toBe(12000);
  });

  it('ignores ImportedReportValue with a fieldKey not present in systemData', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockImportedValues([{ pharmacyId: 1, fieldKey: 'notARealField', amount: 12000 }]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].otherExpenses).toBe(0);
    expect(systemData[1]).not.toHaveProperty('notARealField');
  });

  it('applies PharmacyPdfReport stock values and coefficient from markupPercent', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockPdfReports([
      { pharmacyId: 1, stockRetail: 100000, stockWholesale: 60000, markupPercent: 50 },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].stockRetail).toBe(100000);
    expect(systemData[1].stockWholesale).toBe(60000);
    expect(systemData[1].coefficient).toBe(1.5);
  });

  it('computes totalExpenses as the sum of expense fields and netIncome as income minus expenses', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([
      {
        pharmacyId: 1,
        cashRevenue: 100000,
        terminalRevenue: 0,
        kaspiRevenue: 0,
        expenseItems: [
          { category: 'rentExpenses', amount: 20000 },
          { category: 'utilities', amount: 5000 },
        ],
      },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].totalExpenses).toBe(25000);
    expect(systemData[1].netIncome).toBe(100000 - 25000);
  });

  it('returns an overrideMap keyed by "pharmacyId:fieldKey"', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockOverrides([{ pharmacyId: 1, fieldKey: 'retailRevenue', value: 999 }]);

    const { overrideMap } = await computeMonthlyData(2026, 6);

    expect(overrideMap['1:retailRevenue']).toBe(999);
  });
});
