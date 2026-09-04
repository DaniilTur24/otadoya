import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pharmacy: { findMany: vi.fn() },
    dailyRevenueEntry: { findMany: vi.fn() },
    extractedExpenseEntry: { findMany: vi.fn() },
    importedReportValue: { findMany: vi.fn() },
    monthlyReportOverride: { findMany: vi.fn() },
    pharmacyPdfReport: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/salary-calculator', () => ({
  calculateEmployeeMonthlySalary: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { calculateEmployeeMonthlySalary } from '@/lib/salary-calculator';
import { computeMonthlyData } from '@/lib/monthly-report-builder';

// ─── helpers ─────────────────────────────────────────────────────────────────

type Pharmacy = { id: number; name: string; coefficient: number; terminalRent: number; procedureRent: number; isActive: boolean };

function mockPharmacies(pharmacies: Pharmacy[]) {
  vi.mocked(prisma.pharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(pharmacies);
}

function mockRevenueEntries(revenueEntries: unknown[]) {
  vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(revenueEntries);
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

/** Активные сотрудники, попадающие в расчёт зарплаты в отчёте. */
function mockEmployees(employees: { id: number; employeeType: string; pharmacies: { pharmacyId: number }[] }[] = []) {
  vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(employees);
}

/** calculateEmployeeMonthlySalary — по умолчанию возвращает null (как если бы данных не было). */
function mockSalaryResult(
  result: Partial<{ totalSalary: number; totalBonuses: number; totalAdvances: number; baseSalary: number; allowance: number }> | null
) {
  vi.mocked(calculateEmployeeMonthlySalary as ReturnType<typeof vi.fn>).mockResolvedValue(
    result === null ? null : { totalSalary: 0, totalBonuses: 0, totalAdvances: 0, baseSalary: 0, allowance: 0, ...result }
  );
}

/** Вариант с разным результатом на разные вызовы calculateEmployeeMonthlySalary (по pharmacyId). */
function mockSalaryResultPerPharmacy(byPharmacyId: Record<number, { totalSalary: number; totalBonuses?: number; totalAdvances?: number; baseSalary?: number; allowance?: number }>) {
  vi.mocked(calculateEmployeeMonthlySalary as ReturnType<typeof vi.fn>).mockImplementation(
    (_employeeId: number, _month: number, _year: number, pharmacyId?: number) => {
      const r = pharmacyId != null ? byPharmacyId[pharmacyId] : undefined;
      if (!r) return Promise.resolve(null);
      return Promise.resolve({ totalBonuses: 0, totalAdvances: 0, baseSalary: 0, allowance: 0, ...r });
    }
  );
}

const pharmacy1: Pharmacy = { id: 1, name: 'Аптека №1', coefficient: 0, terminalRent: 0, procedureRent: 0, isActive: true };

beforeEach(() => {
  vi.mocked(calculateEmployeeMonthlySalary as ReturnType<typeof vi.fn>).mockReset();
  mockExtractedExpenses();
  mockImportedValues();
  mockOverrides();
  mockPdfReports();
  mockEmployees();
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

  it('adds a seller/manager pharmaSalary contribution from calculateEmployeeMonthlySalary', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'seller', pharmacies: [{ pharmacyId: 1 }] }]);
    mockSalaryResult({ totalSalary: 25000, totalBonuses: 0, totalAdvances: 0 });

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].pharmaSalary).toBe(25000);
  });

  it('excludes pharmaBonus from pharmaSalary (it is already counted in the pharmaBonus field)', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'seller', pharmacies: [{ pharmacyId: 1 }] }]);
    // totalSalary already includes the 5000 bonus
    mockSalaryResult({ totalSalary: 30000, totalBonuses: 5000, totalAdvances: 0 });

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].pharmaSalary).toBe(25000);
  });

  it('counts an advance as salary: pharmaSalary reflects the full gross amount even after a large advance', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'seller', pharmacies: [{ pharmacyId: 1 }] }]);
    // Advances are no longer a separate expense row on this report (they show up on the
    // employee's profile instead) — an advance is just salary paid early, so pharmaSalary
    // should equal the full 25000 earned, regardless of how much of it was advanced.
    mockSalaryResult({ totalSalary: 25000 - 100000, totalBonuses: 0, totalAdvances: 100000 });

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].pharmaSalary).toBe(25000);
  });

  it('ignores employeeAdvance expense items entirely on this report (no otherExpenses fallback)', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([
      {
        pharmacyId: 1,
        cashRevenue: 0,
        terminalRevenue: 0,
        kaspiRevenue: 0,
        expenseItems: [{ category: 'employeeAdvance', amount: 100000 }],
      },
    ]);

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].otherExpenses).toBe(0);
    expect(systemData[1]).not.toHaveProperty('employeeAdvance');
  });

  it('routes cleaner salary into the cleaning field', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'cleaner', pharmacies: [{ pharmacyId: 1 }] }]);
    mockSalaryResult({ totalSalary: 40000, totalBonuses: 0, totalAdvances: 0 });

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].cleaning).toBe(40000);
    expect(systemData[1].pharmaSalary).toBe(0);
  });

  // Regression QA раунд 3, находка №4: заведующая/менеджер, привязанные к нескольким аптекам,
  // раньше получали свой оклад+доплату в отчёте по КАЖДОЙ аптеке целиком (calculateEmployeeMonthlySalary
  // вызывается отдельно на каждую pharmacyId, и flat-поля не были ни к чему привязаны) — суммарно
  // по всем аптекам оклад задваивался/N-кратился, хотя реально сотруднику платят один раз.
  it('делит оклад+доплату заведующей на количество привязанных аптек, не задваивая их в сумме отчёта', async () => {
    mockPharmacies([pharmacy1, { ...pharmacy1, id: 2, name: 'hi hi' }, { ...pharmacy1, id: 3, name: 'hu hu' }]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'manager_trading', pharmacies: [{ pharmacyId: 1 }, { pharmacyId: 2 }, { pharmacyId: 3 }] }]);
    // baseSalary=190000 + allowance=30000 = 220000 "плоской" части — одинаковой на каждый вызов,
    // независимо от pharmacyId (сменная часть здесь 0, чтобы изолировать именно эту часть).
    mockSalaryResult({ totalSalary: 220000, baseSalary: 190000, allowance: 30000, totalBonuses: 0, totalAdvances: 0 });

    const { systemData } = await computeMonthlyData(2026, 9);

    // По 220000/3 ≈ 73333.33 на каждую аптеку, суммарно — ровно 220000, а не 660000.
    expect(systemData[1].pharmaSalary).toBeCloseTo(220000 / 3);
    expect(systemData[2].pharmaSalary).toBeCloseTo(220000 / 3);
    expect(systemData[3].pharmaSalary).toBeCloseTo(220000 / 3);
    const total = systemData[1].pharmaSalary + systemData[2].pharmaSalary + systemData[3].pharmaSalary;
    expect(total).toBeCloseTo(220000);
  });

  it('не делит сменную часть — она уже корректно относится к своей аптеке', async () => {
    mockPharmacies([pharmacy1, { ...pharmacy1, id: 2, name: 'hi hi' }]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'manager_trading', pharmacies: [{ pharmacyId: 1 }, { pharmacyId: 2 }] }]);
    // Оклад/доплата отсутствуют (0) — вся сумма только от смен, разная в каждой аптеке.
    mockSalaryResultPerPharmacy({
      1: { totalSalary: 50000, baseSalary: 0, allowance: 0 },
      2: { totalSalary: 12000, baseSalary: 0, allowance: 0 },
    });

    const { systemData } = await computeMonthlyData(2026, 9);

    expect(systemData[1].pharmaSalary).toBe(50000);
    expect(systemData[2].pharmaSalary).toBe(12000);
  });

  it('не меняет поведение для сотрудника с одной аптекой (обратная совместимость)', async () => {
    mockPharmacies([pharmacy1]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'seller', pharmacies: [{ pharmacyId: 1 }] }]);
    mockSalaryResult({ totalSalary: 45000, baseSalary: 40000, allowance: 5000, totalBonuses: 0, totalAdvances: 0 });

    const { systemData } = await computeMonthlyData(2026, 9);

    expect(systemData[1].pharmaSalary).toBe(45000);
  });

  it('splits office employee salary evenly across all active pharmacies', async () => {
    mockPharmacies([pharmacy1, { ...pharmacy1, id: 2, name: 'Аптека №2' }]);
    mockRevenueEntries([]);
    mockEmployees([{ id: 1, employeeType: 'office', pharmacies: [] }]);
    mockSalaryResult({ totalSalary: 60000, totalBonuses: 0, totalAdvances: 0 });

    const { systemData } = await computeMonthlyData(2026, 6);

    expect(systemData[1].officeSalary).toBe(30000);
    expect(systemData[2].officeSalary).toBe(30000);
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
