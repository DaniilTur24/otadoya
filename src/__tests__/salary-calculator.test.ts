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
    },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  calculateEmployeeMonthlySalary,
  calculateAllEmployeesSalaries,
} from '@/lib/salary-calculator';

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockEmployee = { id: 1, name: 'Айгуль Смакова', baseSalary: 150000 };

function mockShifts(shifts: { shiftType: string; cashRevenue: number; terminalRevenue: number; kaspiRevenue: number }[]) {
  vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(shifts);
}

function mockBonuses(amount: number) {
  vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
    _sum: { amount },
  });
}

// ─── calculateEmployeeMonthlySalary ──────────────────────────────────────────

describe('calculateEmployeeMonthlySalary', () => {
  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);
    mockBonuses(0);
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
    expect(result!.recordsCount).toBe(0);
  });

  it('calculates day shift salary correctly (baseSalary / 15)', async () => {
    mockShifts([{ shiftType: 'day', cashRevenue: 10000, terminalRevenue: 5000, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.dayShiftsCount).toBe(1);
    expect(result!.salaryFromDayShifts).toBeCloseTo(150000 / 15, 5);
    expect(result!.salaryFromFullDayShifts).toBe(0);
  });

  it('calculates full_day shift salary correctly (baseSalary / 10)', async () => {
    mockShifts([{ shiftType: 'full_day', cashRevenue: 8000, terminalRevenue: 3000, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.fullDayShiftsCount).toBe(1);
    expect(result!.salaryFromFullDayShifts).toBeCloseTo(150000 / 10, 5);
    expect(result!.salaryFromDayShifts).toBe(0);
  });

  it('sums mixed shift types and bonuses into totalSalary', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'full_day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    mockBonuses(5000);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    const expected = 150000 / 15 + 150000 / 10 + 5000;
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

    const result = await calculateAllEmployeesSalaries(1, 2025);
    expect(result).toHaveLength(1);
    expect(result[0].employeeName).toBe('Работник');
  });
});
