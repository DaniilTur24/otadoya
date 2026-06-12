import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    dailyRevenueEntry: {
      findMany: vi.fn(),
    },
    dailyExpenseItem: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    workingCalendar: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  calculateEmployeeMonthlySalary,
  calculateAllEmployeesSalaries,
  getEmployeeMonthlyAdvances,
} from '@/lib/salary-calculator';

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockEmployee = { id: 1, name: 'Айгуль Смакова', baseSalary: 150000 };

function mockShifts(shifts: { shiftType: string; cashRevenue: number; terminalRevenue: number; kaspiRevenue: number }[]) {
  vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(shifts);
}

function mockAggregates(bonuses: number, advances = 0) {
  vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { where?: { category?: string } }) => {
      const amount = args?.where?.category === 'employeeAdvance' ? advances : bonuses;
      return Promise.resolve({ _sum: { amount } });
    }
  );
}
function mockBonuses(amount: number) {
  mockAggregates(amount, 0);
}

function mockCalendar(workingDays: number | null) {
  vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
    workingDays !== null ? { workingDays } : null
  );
}

// ─── calculateEmployeeMonthlySalary ──────────────────────────────────────────

describe('calculateEmployeeMonthlySalary', () => {
  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);
    mockBonuses(0);
    mockCalendar(null);
  });

  it('returns null when employee does not exist', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    mockShifts([]);
    expect(await calculateEmployeeMonthlySalary(999, 1, 2025)).toBeNull();
  });

  it('returns zero salary when no shifts', async () => {
    mockShifts([]);
    const result = await calculateEmployeeMonthlySalary(1, 1, 2025);
    expect(result).not.toBeNull();
    expect(result!.totalSalary).toBe(0);
    expect(result!.dayShiftsCount).toBe(0);
    expect(result!.fullDayShiftsCount).toBe(0);
    expect(result!.fiveDayShiftsCount).toBe(0);
    expect(result!.recordsCount).toBe(0);
  });

  it('calculates day shift salary correctly (baseSalary / 15)', async () => {
    mockShifts([{ shiftType: 'day', cashRevenue: 10000, terminalRevenue: 5000, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.dayShiftsCount).toBe(1);
    expect(result!.salaryFromDayShifts).toBeCloseTo(150000 / 15, 5);
    expect(result!.salaryFromFullDayShifts).toBe(0);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
  });

  it('calculates full_day shift salary correctly (baseSalary / 10)', async () => {
    mockShifts([{ shiftType: 'full_day', cashRevenue: 8000, terminalRevenue: 3000, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.fullDayShiftsCount).toBe(1);
    expect(result!.salaryFromFullDayShifts).toBeCloseTo(150000 / 10, 5);
    expect(result!.salaryFromDayShifts).toBe(0);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
  });

  it('sums mixed shift types and bonuses into totalSalary', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'full_day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    mockBonuses(5000);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    const revenuePremium = (10000 - 200000) * 0.015 + (10000 - 300000) * 0.015;
    const expected = 150000 / 15 + 150000 / 10 + 5000 + revenuePremium;
    expect(result!.totalSalary).toBeCloseTo(expected, 5);
    expect(result!.totalBonuses).toBe(5000);
  });

  it('sums revenue across all shifts', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 10000, terminalRevenue: 5000, kaspiRevenue: 2000 },
      { shiftType: 'full_day', cashRevenue: 8000, terminalRevenue: 3000, kaspiRevenue: 1000 },
    ]);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.revenueTotal).toBe(10000 + 5000 + 2000 + 8000 + 3000 + 1000);
  });

  it('returns zero salary when baseSalary is 0', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockEmployee, baseSalary: 0 });
    mockShifts([
      { shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 1, 2025);
    expect(result!.salaryFromDayShifts).toBe(0);
    expect(result!.salaryFromFullDayShifts).toBe(0);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
  });

  it('subtracts advances from totalSalary and can go negative', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    mockAggregates(0, 200000);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    const revenuePremium = (10000 - 200000) * 0.015;
    const expected = 150000 / 15 + revenuePremium - 200000;
    expect(result!.totalAdvances).toBe(200000);
    expect(result!.totalSalary).toBeCloseTo(expected, 5);
    expect(result!.totalSalary).toBeLessThan(0);
  });

  it('returns correct meta fields', async () => {
    mockShifts([]);
    const result = await calculateEmployeeMonthlySalary(1, 3, 2025);
    expect(result!.employeeId).toBe(1);
    expect(result!.employeeName).toBe('Айгуль Смакова');
    expect(result!.month).toBe(3);
    expect(result!.year).toBe(2025);
    expect(result!.baseSalary).toBe(150000);
  });

  // ─── пятидневная смена ────────────────────────────────────────────────────

  it('calculates five_day shift salary correctly (baseSalary / workingDays)', async () => {
    mockCalendar(22);
    mockShifts([{ shiftType: 'five_day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.fiveDayShiftsCount).toBe(1);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo(150000 / 22, 5);
    expect(result!.workingCalendarDays).toBe(22);
    expect(result!.salaryFromDayShifts).toBe(0);
    expect(result!.salaryFromFullDayShifts).toBe(0);
  });

  it('returns zero for five_day salary when calendar not configured', async () => {
    mockCalendar(null);
    mockShifts([{ shiftType: 'five_day', cashRevenue: 5000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.fiveDayShiftsCount).toBe(1);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
    expect(result!.workingCalendarDays).toBeNull();
    expect(result!.totalSalary).toBe(0);
  });

  it('sums all three shift types into totalSalary', async () => {
    mockCalendar(20);
    mockShifts([
      { shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'full_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 2, 2025);
    const revenuePremium = (0 - 200000) * 0.015 + (0 - 300000) * 0.015;
    const expected = 150000 / 15 + 150000 / 10 + (150000 / 20) * 2 + revenuePremium;
    expect(result!.dayShiftsCount).toBe(1);
    expect(result!.fullDayShiftsCount).toBe(1);
    expect(result!.fiveDayShiftsCount).toBe(2);
    expect(result!.totalSalary).toBeCloseTo(expected, 5);
  });

  it('five_day salary uses workingDays from calendar, not a fixed divisor', async () => {
    mockCalendar(19); // январь — 19 рабочих дней
    mockShifts([
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 1, 2025);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo((150000 / 19) * 3, 5);
  });

  it('returns zero five_day salary when baseSalary is 0', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockEmployee, baseSalary: 0 });
    mockCalendar(22);
    mockShifts([{ shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
  });

  it('workingCalendarDays is exposed in result even when no five_day shifts', async () => {
    mockCalendar(22);
    mockShifts([{ shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.workingCalendarDays).toBe(22);
    expect(result!.fiveDayShiftsCount).toBe(0);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
  });

  // ─── премия по выручке ────────────────────────────────────────────────────

  it('calculates positive revenue premium for a single day shift above threshold', async () => {
    mockShifts([{ shiftType: 'day', cashRevenue: 150000, terminalRevenue: 70000, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // (220000 - 200000) * 1.5% = 300
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(300, 5);
    expect(result!.revenuePremiumFullDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBeCloseTo(300, 5);
  });

  it('calculates positive revenue premium for a single full_day shift above threshold', async () => {
    mockShifts([{ shiftType: 'full_day', cashRevenue: 200000, terminalRevenue: 120000, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // (320000 - 300000) * 1.5% = 300
    expect(result!.revenuePremiumFullDayShifts).toBeCloseTo(300, 5);
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBeCloseTo(300, 5);
  });

  it('averages revenue across multiple day shifts before applying the threshold', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 300000, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'day', cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // avg = 250000, (250000 - 200000) * 1.5% * 2 = 1500
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(1500, 5);
  });

  it('sums separately calculated premiums when employee works both day and full_day shifts', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 220000, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'full_day', cashRevenue: 320000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(300, 5);
    expect(result!.revenuePremiumFullDayShifts).toBeCloseTo(300, 5);
    expect(result!.totalRevenuePremium).toBeCloseTo(600, 5);
  });

  it('returns a negative revenue premium when average revenue is below the threshold, not floored at 0', async () => {
    mockShifts([{ shiftType: 'day', cashRevenue: 100000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // (100000 - 200000) * 1.5% = -1500
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(-1500, 5);
    expect(result!.totalRevenuePremium).toBeCloseTo(-1500, 5);
  });

  it('does not include a revenue premium for five_day shifts', async () => {
    mockCalendar(20);
    mockShifts([{ shiftType: 'five_day', cashRevenue: 1000000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.revenuePremiumFullDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBe(0);
  });
});

// ─── calculateAllEmployeesSalaries ───────────────────────────────────────────

describe('calculateAllEmployeesSalaries', () => {
  it('returns empty array when no active employees', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await calculateAllEmployeesSalaries(1, 2025);
    expect(result).toEqual([]);
  });

  it('excludes employees with zero records', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, name: 'Сотрудник', baseSalary: 100000, isActive: true },
    ]);
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, name: 'Сотрудник', baseSalary: 100000 });
    vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { amount: 0 } });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await calculateAllEmployeesSalaries(1, 2025);
    expect(result).toHaveLength(0);
  });

  it('includes employees with at least one shift', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 2, name: 'Работник', baseSalary: 120000, isActive: true },
    ]);
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 2, name: 'Работник', baseSalary: 120000 });
    vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { shiftType: 'day', cashRevenue: 5000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { amount: 0 } });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await calculateAllEmployeesSalaries(1, 2025);
    expect(result).toHaveLength(1);
    expect(result[0].employeeName).toBe('Работник');
  });
});

// ─── getEmployeeMonthlyAdvances ──────────────────────────────────────────────

describe('getEmployeeMonthlyAdvances', () => {
  it('returns empty array when employee has no advances', async () => {
    vi.mocked(prisma.dailyExpenseItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await getEmployeeMonthlyAdvances(1, 5, 2025);
    expect(result).toEqual([]);
  });

  it('maps advance items to AdvanceEntry with date, pharmacy and amount', async () => {
    const entryDate = new Date('2025-05-10');
    vi.mocked(prisma.dailyExpenseItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 11,
        amount: 15000,
        comment: 'Аванс: Иван Петров',
        entry: { date: entryDate, pharmacy: { name: 'Аптека на Абая' } },
      },
    ]);

    const result = await getEmployeeMonthlyAdvances(2, 5, 2025);
    expect(result).toEqual([
      { id: 11, date: entryDate, pharmacyName: 'Аптека на Абая', amount: 15000, comment: 'Аванс: Иван Петров' },
    ]);
  });

  it('queries by recipient employeeId, not the entry employee', async () => {
    const findMany = vi.mocked(prisma.dailyExpenseItem.findMany as ReturnType<typeof vi.fn>);
    findMany.mockResolvedValue([]);

    await getEmployeeMonthlyAdvances(7, 6, 2025, 3);

    const where = findMany.mock.calls[findMany.mock.calls.length - 1][0].where;
    expect(where.category).toBe('employeeAdvance');
    expect(where.employeeId).toBe(7);
    expect(where.entry.pharmacyId).toBe(3);
    expect(where.entry.status).toBe('approved');
  });
});
