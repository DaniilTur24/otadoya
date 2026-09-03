import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    pharmacy: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dailyRevenueEntry: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    dailyExpenseItem: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    workingCalendar: {
      findFirst: vi.fn(),
    },
    attendanceShift: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    officePremiumTier: {
      findMany: vi.fn(),
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

function mockAggregates(bonuses: number, advances = 0, surcharges = 0) {
  vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { where?: { category?: string } }) => {
      const category = args?.where?.category;
      const amount = category === 'employeeAdvance' ? advances : category === 'employeeSurcharge' ? surcharges : bonuses;
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
    // Revenue is far below threshold on both shift types — premium floors at 0, not negative
    const revenuePremium = Math.max(0, (10000 - 200000) * 0.015) + Math.max(0, (10000 - 300000) * 0.015);
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
    // Premium floors at 0 (revenue below threshold) — the advance alone drives totalSalary negative here
    const revenuePremium = Math.max(0, (10000 - 200000) * 0.015);
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
  // 'five_day' в записи выручки — устаревший способ и больше не выбирается в UI
  // (см. src/lib/shift-types.ts); зарплату он не даёт ни при каких условиях —
  // пятидневка считается только через табель (fiveDayViaAttendance), см. ниже.

  it('gives no salary for a legacy five_day revenue entry, even with a calendar configured', async () => {
    mockCalendar(22);
    mockShifts([{ shiftType: 'five_day', cashRevenue: 10000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.fiveDayShiftsCount).toBe(0);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
    expect(result!.salaryFromDayShifts).toBe(0);
    expect(result!.salaryFromFullDayShifts).toBe(0);
  });

  it('day/full_day shifts still pay normally when legacy five_day entries are mixed in', async () => {
    mockCalendar(20);
    mockShifts([
      { shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'full_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 2, 2025);
    // Zero revenue on both shift types — premium floors at 0, not negative
    const revenuePremium = Math.max(0, (0 - 200000) * 0.015) + Math.max(0, (0 - 300000) * 0.015);
    const expected = 150000 / 15 + 150000 / 10 + revenuePremium;
    expect(result!.dayShiftsCount).toBe(1);
    expect(result!.fullDayShiftsCount).toBe(1);
    expect(result!.fiveDayShiftsCount).toBe(0);
    expect(result!.totalSalary).toBeCloseTo(expected, 5);
  });

  it('sources fiveDayShiftsCount from attendance, not revenue entries, when fiveDayViaAttendance is on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockEmployee,
      fiveDayViaAttendance: true,
    });
    mockCalendar(20);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    mockShifts([]); // no revenue entries at all — attendance is the only source now
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.fiveDayShiftsCount).toBe(3);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo((150000 / 20) * 3, 5);
  });

  it('recordsCount includes attendance-based five-day shifts when there are no revenue entries', async () => {
    // Продавец с включённой «Пятидневкой» не создаёт DailyRevenueEntry — recordsCount
    // должен всё равно быть > 0, иначе карточка сотрудника и calculateAllEmployeesSalaries
    // скрывают/пропускают уже начисленную зарплату (regression: recordsCount игнорировал табель).
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockEmployee,
      fiveDayViaAttendance: true,
    });
    mockCalendar(20);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    mockShifts([]);
    const result = await calculateEmployeeMonthlySalary(1, 8, 2026);
    expect(result!.recordsCount).toBe(2);
    expect(result!.totalSalary).toBeCloseTo((150000 / 20) * 2, 5);
  });

  it('ignores legacy five_day revenue entries (does not double-count) once fiveDayViaAttendance is on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockEmployee,
      fiveDayViaAttendance: true,
    });
    mockCalendar(20);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    // Old revenue-entry-based five_day shifts recorded before the flag was turned on
    mockShifts([
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'five_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    // Count comes from attendance (2), not from the 2 legacy entries on top of it
    expect(result!.fiveDayShiftsCount).toBe(2);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo((150000 / 20) * 2, 5);
  });

  it('day/full_day shifts still count from revenue entries even when fiveDayViaAttendance is on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockEmployee,
      fiveDayViaAttendance: true,
    });
    mockCalendar(20);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockShifts([{ shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 6, 2025);
    expect(result!.dayShiftsCount).toBe(1);
    expect(result!.salaryFromDayShifts).toBeCloseTo(150000 / 15, 5);
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

  it('floors the revenue premium at 0 when average revenue is below the threshold, never penalizing salary', async () => {
    mockShifts([{ shiftType: 'day', cashRevenue: 100000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // (100000 - 200000) * 1.5% = -1500, floored at 0 — premium is a bonus, not a penalty
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBe(0);
  });

  it('floors each shift type independently — a below-threshold day shift does not offset a strong full_day shift', async () => {
    mockShifts([
      { shiftType: 'day', cashRevenue: 100000, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'full_day', cashRevenue: 400000, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // day: (100000 - 200000) * 1.5% = -1500 -> floored to 0
    // full_day: (400000 - 300000) * 1.5% = 1500
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.revenuePremiumFullDayShifts).toBeCloseTo(1500, 5);
    expect(result!.totalRevenuePremium).toBeCloseTo(1500, 5);
  });

  it('does not include a revenue premium for five_day shifts', async () => {
    mockCalendar(20);
    mockShifts([{ shiftType: 'five_day', cashRevenue: 1000000, terminalRevenue: 0, kaspiRevenue: 0 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.revenuePremiumFullDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBe(0);
  });

  it('excludes kaspi revenue from the personal revenue premium', async () => {
    // Порог 200000 — cash+terminal одни не дотягивают, kaspi добавляет ещё 100000, но он
    // не должен учитываться при расчёте премии продавца.
    mockShifts([{ shiftType: 'day', cashRevenue: 150000, terminalRevenue: 0, kaspiRevenue: 100000 }]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBe(0);
  });

  it('adds the fixed employee allowance to totalSalary regardless of employee type', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockEmployee,
      allowance: 15000,
      allowanceDescription: 'за стаж',
    });
    mockShifts([]);
    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.allowance).toBe(15000);
    expect(result!.allowanceDescription).toBe('за стаж');
    expect(result!.totalSalary).toBe(15000);
  });
});

// ─── pooled average revenue premium (Pharmacy.poolAverageRevenuePremium) ────

describe('calculateEmployeeMonthlySalary — pool average revenue premium', () => {
  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);
    mockBonuses(0);
    mockCalendar(null);
  });

  it('uses the pharmacy-wide average revenue per shift instead of personal revenue when enabled', async () => {
    vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where?: { employeeId?: number } }) => {
        if (args?.where?.employeeId !== undefined) {
          // Личная выручка сотрудника за смену — ниже порога, сама по себе премии не дала бы.
          return Promise.resolve([
            { pharmacyId: 10, shiftType: 'day', cashRevenue: 100000, terminalRevenue: 0, kaspiRevenue: 0 },
          ]);
        }
        // Общая выручка аптеки за все дневные смены месяца: (500000)/2 = 250000 средняя.
        return Promise.resolve([
          { pharmacyId: 10, shiftType: 'day', cashRevenue: 300000, terminalRevenue: 0, kaspiRevenue: 0 },
          { pharmacyId: 10, shiftType: 'day', cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0 },
        ]);
      }
    );
    vi.mocked(prisma.pharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 10, poolAverageRevenuePremium: true },
    ]);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // (250000 - 200000) * 1.5% = 750 за смену, у сотрудника 1 такая смена.
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(750, 5);
  });

  it('falls back to personal revenue when the pharmacy flag is off', async () => {
    vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where?: { employeeId?: number } }) => {
        if (args?.where?.employeeId !== undefined) {
          return Promise.resolve([
            { pharmacyId: 10, shiftType: 'day', cashRevenue: 220000, terminalRevenue: 0, kaspiRevenue: 0 },
          ]);
        }
        return Promise.resolve([]);
      }
    );
    vi.mocked(prisma.pharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 10, poolAverageRevenuePremium: false },
    ]);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    // (220000 - 200000) * 1.5% = 300, от собственной выручки.
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(300, 5);
  });

  it('excludes kaspi revenue from the pool average too', async () => {
    vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where?: { employeeId?: number } }) => {
        if (args?.where?.employeeId !== undefined) {
          return Promise.resolve([
            { pharmacyId: 10, shiftType: 'day', cashRevenue: 100000, terminalRevenue: 0, kaspiRevenue: 0 },
          ]);
        }
        // Без kaspi cash+terminal среднее — ровно порог (200000), премии быть не должно,
        // хотя с учётом kaspi среднее было бы 300000 и дало бы 1500.
        return Promise.resolve([
          { pharmacyId: 10, shiftType: 'day', cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 100000 },
          { pharmacyId: 10, shiftType: 'day', cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 100000 },
        ]);
      }
    );
    vi.mocked(prisma.pharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 10, poolAverageRevenuePremium: true },
    ]);

    const result = await calculateEmployeeMonthlySalary(1, 5, 2025);
    expect(result!.revenuePremiumDayShifts).toBe(0);
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

  it('includes a fiveDayViaAttendance seller even with zero revenue entries this month', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 6, name: 'Продавец на пятидневке', baseSalary: 150000, isActive: true },
    ]);
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 6,
      name: 'Продавец на пятидневке',
      baseSalary: 150000,
      employeeType: 'seller',
      fiveDayViaAttendance: true,
      pharmacies: [],
      allowance: 0,
    });
    vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { amount: 0 } });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ workingDays: 20 });
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await calculateAllEmployeesSalaries(8, 2026);
    expect(result).toHaveLength(1);
    expect(result[0].recordsCount).toBe(2);
    expect(result[0].totalSalary).toBeCloseTo((150000 / 20) * 2, 5);
  });

  it('includes a manager_trading employee even with zero personal shifts this month', async () => {
    // Заведующая не торговала лично в этом месяце, но её аптека всё равно
    // заработала бонусы/выручку — её 10%/доплата/премия не должны пропасть из расчёта.
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 25, name: 'Заведующая', baseSalary: 200000, isActive: true },
    ]);
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 25,
      name: 'Заведующая',
      baseSalary: 200000,
      employeeType: 'manager_trading',
      pharmacies: [{ employeeId: 25, pharmacyId: 2 }],
      allowance: 20000,
      managerBonusShareEnabled: true,
    });
    mockRevenueEntries({
      shifts: [],
      pharmacyRevenueRows: [{ pharmacyId: 2, cashRevenue: 500000, terminalRevenue: 0, kaspiRevenue: 0 }],
    });
    mockExpenseAggregates({ managerBonusBase: 10000 });
    mockManagedPharmacies([{ id: 2 }]);
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await calculateAllEmployeesSalaries(6, 2026);
    expect(result).toHaveLength(1);
    expect(result[0].recordsCount).toBe(0);
    expect(result[0].allowance).toBe(20000);
    expect(result[0].managerBonusShare).toBeCloseTo(1000, 5);
  });
});

// ─── manager_trading / manager_fixed / cleaner / office ──────────────────────

function mockExpenseAggregates(opts: { ownBonuses?: number; advances?: number; surcharges?: number; managerBonusBase?: number } = {}) {
  const { ownBonuses = 0, advances = 0, surcharges = 0, managerBonusBase = 0 } = opts;
  vi.mocked(prisma.dailyExpenseItem.aggregate as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { where?: { category?: string; entry?: { employeeId?: number } } }) => {
      if (args?.where?.category === 'employeeAdvance') return Promise.resolve({ _sum: { amount: advances } });
      if (args?.where?.category === 'employeeSurcharge') return Promise.resolve({ _sum: { amount: surcharges } });
      if (args?.where?.entry?.employeeId !== undefined) return Promise.resolve({ _sum: { amount: ownBonuses } });
      return Promise.resolve({ _sum: { amount: managerBonusBase } });
    }
  );
}

function mockRevenueEntries(opts: {
  shifts?: { shiftType: string; cashRevenue: number; terminalRevenue: number; kaspiRevenue: number }[];
  pharmacyRevenueRows?: { pharmacyId: number; cashRevenue: number; terminalRevenue: number; kaspiRevenue: number }[];
} = {}) {
  const { shifts = [], pharmacyRevenueRows = [] } = opts;
  vi.mocked(prisma.dailyRevenueEntry.findMany as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { where?: { employeeId?: number } }) => {
      if (args?.where?.employeeId !== undefined) return Promise.resolve(shifts);
      return Promise.resolve(pharmacyRevenueRows);
    }
  );
}

function mockManagedPharmacies(
  pharmacies: {
    id: number;
    managerPremiumThreshold?: number | null;
    managerPremiumBase?: number | null;
    managerPremiumStepAmount?: number | null;
    managerPremiumStepBonus?: number | null;
  }[]
) {
  vi.mocked(prisma.pharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    pharmacies.map((p) => ({
      managerPremiumThreshold: null,
      managerPremiumBase: null,
      managerPremiumStepAmount: null,
      managerPremiumStepBonus: null,
      ...p,
    }))
  );
}

describe('calculateEmployeeMonthlySalary — manager_trading', () => {
  const manager = {
    id: 5,
    name: 'Заведующая Алия',
    baseSalary: 150000,
    employeeType: 'manager_trading',
    pharmacies: [{ employeeId: 5, pharmacyId: 10 }],
    managerBonusShareEnabled: true,
  };

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(manager);
    mockExpenseAggregates();
    mockManagedPharmacies([{ id: 10 }]);
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('applies the same revenue premium as a seller (200k/300k threshold, 1.5%)', async () => {
    mockRevenueEntries({ shifts: [{ shiftType: 'day', cashRevenue: 220000, terminalRevenue: 0, kaspiRevenue: 0 }] });
    const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    // (220000 - 200000) * 1.5% = 300
    expect(result!.revenuePremiumDayShifts).toBeCloseTo(300, 5);
    expect(result!.totalRevenuePremium).toBeCloseTo(300, 5);
  });

  it('floors the revenue premium at 0 when revenue is below threshold, like a seller', async () => {
    mockRevenueEntries({ shifts: [{ shiftType: 'day', cashRevenue: 100000, terminalRevenue: 0, kaspiRevenue: 0 }] });
    const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.revenuePremiumDayShifts).toBe(0);
    expect(result!.totalRevenuePremium).toBe(0);
  });

  it('adds 10% of pharmacy bonuses (managerBonusShare) on top of shift salary', async () => {
    mockRevenueEntries({ shifts: [{ shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 }] });
    mockExpenseAggregates({ ownBonuses: 1000, managerBonusBase: 50000 });
    const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.managerBonusShare).toBeCloseTo(5000, 5); // 10% of 50000
    expect(result!.managedBonusTotal).toBe(50000);
    expect(result!.totalBonuses).toBe(1000);
    expect(result!.totalSalary).toBeCloseTo(150000 / 15 + 1000 + 5000, 5);
  });

  it('rounds managerBonusShare to the nearest 5 tenge', async () => {
    mockRevenueEntries({ shifts: [{ shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 }] });
    // 10% of these totals: 123410 -> 12341 -> rounds to 12340
    //                       123430 -> 12343 -> rounds to 12345
    //                       123480 -> 12348 -> rounds to 12350
    mockExpenseAggregates({ ownBonuses: 0, managerBonusBase: 123410 });
    let result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.managerBonusShare).toBe(12340);

    mockExpenseAggregates({ ownBonuses: 0, managerBonusBase: 123430 });
    result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.managerBonusShare).toBe(12345);

    mockExpenseAggregates({ ownBonuses: 0, managerBonusBase: 123480 });
    result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.managerBonusShare).toBe(12350);
  });

  it('skips managerBonusShare when managerBonusShareEnabled is false', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...manager,
      managerBonusShareEnabled: false,
    });
    mockRevenueEntries({ shifts: [{ shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 }] });
    mockExpenseAggregates({ ownBonuses: 1000, managerBonusBase: 50000 });
    const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.managerBonusShare).toBe(0);
    expect(result!.managerBonusShareEnabled).toBe(false);
    expect(result!.totalSalary).toBeCloseTo(150000 / 15 + 1000, 5);
  });

  it('adds the employee allowance', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...manager, allowance: 20000 });
    mockRevenueEntries({ shifts: [] });
    mockManagedPharmacies([{ id: 10 }]);
    const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    expect(result!.allowance).toBe(20000);
    expect(result!.totalSalary).toBe(20000);
  });

  it('never applies the pharmacy ladder premium, even when pharmacy revenue clears the threshold', async () => {
    mockRevenueEntries({
      shifts: [],
      pharmacyRevenueRows: [{ pharmacyId: 10, cashRevenue: 450000, terminalRevenue: 0, kaspiRevenue: 0 }],
    });
    mockManagedPharmacies([
      { id: 10, managerPremiumThreshold: 400000, managerPremiumBase: 10000, managerPremiumStepAmount: 50000, managerPremiumStepBonus: 5000 },
    ]);
    const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
    // Ladder premium is exclusive to manager_fixed now — manager_trading gets none, regardless
    // of the pharmacy's configured threshold/base/step.
    expect(result!.managerLadderPremium).toBe(0);
    expect(result!.managedRevenueTotal).toBe(0);
    expect(result!.totalSalary).toBe(0);
  });

  describe('fiveDayViaAttendance = true', () => {
    it('sources fiveDayShiftsCount from attendance, using the same calendar-prorated formula as a seller', async () => {
      vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...manager,
        fiveDayViaAttendance: true,
      });
      vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ workingDays: 20 });
      vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);
      mockRevenueEntries({ shifts: [] }); // no revenue shifts at all — attendance is the only source now
      const result = await calculateEmployeeMonthlySalary(5, 6, 2025);
      expect(result!.fiveDayShiftsCount).toBe(4);
      expect(result!.salaryFromFiveDayShifts).toBeCloseTo((150000 / 20) * 4, 5);
      expect(result!.totalSalary).toBeCloseTo((150000 / 20) * 4, 5);
    });

    it('recordsCount includes attendance days even with zero revenue entries', async () => {
      vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...manager,
        fiveDayViaAttendance: true,
      });
      vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ workingDays: 20 });
      vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
      mockRevenueEntries({ shifts: [] });
      const result = await calculateEmployeeMonthlySalary(5, 6, 2025);
      expect(result!.recordsCount).toBe(2);
    });
  });

  describe('ladderPremiumEnabled = true', () => {
    const managerWithLadder = {
      id: 5,
      name: 'Заведующая Алия',
      baseSalary: 150000,
      employeeType: 'manager_trading',
      pharmacies: [{ employeeId: 5, pharmacyId: 10 }],
      ladderPremiumEnabled: true,
    };

    it('applies pharmacy ladder premium instead of personal revenue premium', async () => {
      vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(managerWithLadder);
      mockRevenueEntries({
        shifts: [{ shiftType: 'day', cashRevenue: 450000, terminalRevenue: 0, kaspiRevenue: 0 }],
        pharmacyRevenueRows: [{ pharmacyId: 10, cashRevenue: 450000, terminalRevenue: 0, kaspiRevenue: 0 }],
      });
      mockManagedPharmacies([
        { id: 10, managerPremiumThreshold: 400000, managerPremiumBase: 10000, managerPremiumStepAmount: 50000, managerPremiumStepBonus: 5000 },
      ]);
      const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
      // Личная премия должна быть 0 (хотя выручка 450к > порога 200к)
      expect(result!.totalRevenuePremium).toBe(0);
      expect(result!.revenuePremiumDayShifts).toBe(0);
      // Лестничная: base=10000, (450000-400000)/50000=1 шаг → 10000+5000=15000
      expect(result!.managerLadderPremium).toBe(15000);
      expect(result!.managedRevenueTotal).toBe(450000);
    });

    it('returns zero personal premium even when shift revenue exceeds threshold', async () => {
      vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(managerWithLadder);
      mockRevenueEntries({
        shifts: [{ shiftType: 'full_day', cashRevenue: 500000, terminalRevenue: 0, kaspiRevenue: 0 }],
        pharmacyRevenueRows: [{ pharmacyId: 10, cashRevenue: 500000, terminalRevenue: 0, kaspiRevenue: 0 }],
      });
      mockManagedPharmacies([{ id: 10, managerPremiumThreshold: 600000, managerPremiumBase: 8000, managerPremiumStepAmount: null, managerPremiumStepBonus: null }]);
      const result = await calculateEmployeeMonthlySalary(5, 5, 2025);
      expect(result!.totalRevenuePremium).toBe(0);
      expect(result!.revenuePremiumFullDayShifts).toBe(0);
      // Выручка 500k < порог 600k → лестничная тоже 0
      expect(result!.managerLadderPremium).toBe(0);
    });
  });
});

describe('calculateEmployeeMonthlySalary — seller_five_day_fixed', () => {
  const mixedEmployee = {
    id: 20,
    name: 'Нурлан Ахметов',
    baseSalary: 150000,
    employeeType: 'seller_five_day_fixed',
    shiftRate: 12500,
  };

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mixedEmployee);
    mockBonuses(0);
    mockCalendar(null);
  });

  it('pays only the fixed attendance rate when the employee never gets a revenue shift', async () => {
    mockShifts([]);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);
    const result = await calculateEmployeeMonthlySalary(20, 6, 2025);
    expect(result!.fiveDayShiftsCount).toBe(10);
    expect(result!.shiftRate).toBe(12500);
    expect(result!.salaryFromFiveDayShifts).toBe(125000);
    expect(result!.dayShiftsCount).toBe(0);
    expect(result!.fullDayShiftsCount).toBe(0);
    expect(result!.totalSalary).toBe(125000);
  });

  it('does NOT divide the fixed rate by the working-calendar days, unlike fiveDayViaAttendance', async () => {
    mockCalendar(20); // if this were used, 10 shifts would instead yield (baseSalary/20)*10 = 75000
    mockShifts([]);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);
    const result = await calculateEmployeeMonthlySalary(20, 6, 2025);
    expect(result!.salaryFromFiveDayShifts).toBe(125000);
  });

  it('combines revenue shifts (from baseSalary) and attendance days (from shiftRate) in the same month', async () => {
    mockShifts([
      { shiftType: 'full_day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
      { shiftType: 'day', cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    ]);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);
    const result = await calculateEmployeeMonthlySalary(20, 6, 2025);
    const revenuePremium = Math.max(0, (0 - 200000) * 0.015) + Math.max(0, (0 - 300000) * 0.015); // floors at 0
    const expected = 150000 / 10 + 150000 / 15 + 4 * 12500 + revenuePremium;
    expect(result!.salaryFromFullDayShifts).toBeCloseTo(150000 / 10, 5);
    expect(result!.salaryFromDayShifts).toBeCloseTo(150000 / 15, 5);
    expect(result!.salaryFromFiveDayShifts).toBe(50000);
    expect(result!.totalSalary).toBeCloseTo(expected, 5);
  });

  it('returns zero attendance salary when shiftRate is not set', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mixedEmployee,
      shiftRate: null,
    });
    mockShifts([]);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const result = await calculateEmployeeMonthlySalary(20, 6, 2025);
    expect(result!.shiftRate).toBeNull();
    expect(result!.salaryFromFiveDayShifts).toBe(0);
    expect(result!.totalSalary).toBe(0);
  });

  it('subtracts advances from the combined total', async () => {
    mockShifts([]);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);
    mockAggregates(0, 30000);
    const result = await calculateEmployeeMonthlySalary(20, 6, 2025);
    expect(result!.totalAdvances).toBe(30000);
    expect(result!.totalSalary).toBe(4 * 12500 - 30000);
  });

  it('recordsCount includes attendance days so calculateAllEmployeesSalaries does not drop a pure-attendance month', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mixedEmployee);
    mockShifts([]);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const result = await calculateEmployeeMonthlySalary(20, 6, 2025);
    expect(result!.recordsCount).toBe(3);
  });
});

describe('calculateEmployeeMonthlySalary — manager_fixed', () => {
  const manager = {
    id: 6,
    name: 'Заведующая Гульнара',
    baseSalary: 100000,
    employeeType: 'manager_fixed',
    pharmacies: [{ employeeId: 6, pharmacyId: 11 }],
    ladderPremiumEnabled: true,
    managerBonusShareEnabled: true,
  };

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(manager);
    mockExpenseAggregates();
    mockManagedPharmacies([{ id: 11 }]);
    mockRevenueEntries();
  });

  it('computes salary from attendance shifts using the working calendar (five-day formula)', async () => {
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ workingDays: 20 });
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);
    const result = await calculateEmployeeMonthlySalary(6, 6, 2025);
    expect(result!.attendanceShiftsCount).toBe(10);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo((100000 / 20) * 10, 5);
    expect(result!.totalSalary).toBeCloseTo((100000 / 20) * 10, 5);
  });

  it('returns zero base salary when calendar is not configured', async () => {
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const result = await calculateEmployeeMonthlySalary(6, 6, 2025);
    expect(result!.salaryFromFiveDayShifts).toBe(0);
  });

  it('includes managerBonusShare, allowance and ladder premium when both toggles are on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...manager, allowance: 30000 });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockExpenseAggregates({ managerBonusBase: 30000 });
    mockManagedPharmacies([{ id: 11, managerPremiumThreshold: 400000, managerPremiumBase: 10000 }]);
    mockRevenueEntries({ pharmacyRevenueRows: [{ pharmacyId: 11, cashRevenue: 500000, terminalRevenue: 0, kaspiRevenue: 0 }] });
    const result = await calculateEmployeeMonthlySalary(6, 6, 2025);
    expect(result!.managerBonusShare).toBeCloseTo(3000, 5);
    expect(result!.managerLadderPremium).toBe(10000);
    expect(result!.allowance).toBe(30000);
    expect(result!.totalSalary).toBeCloseTo(3000 + 10000 + 30000, 5);
  });

  it('skips the ladder premium when ladderPremiumEnabled is false, even if the pharmacy has thresholds configured', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...manager,
      ladderPremiumEnabled: false,
    });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockManagedPharmacies([{ id: 11, managerPremiumThreshold: 400000, managerPremiumBase: 10000 }]);
    mockRevenueEntries({ pharmacyRevenueRows: [{ pharmacyId: 11, cashRevenue: 500000, terminalRevenue: 0, kaspiRevenue: 0 }] });
    const result = await calculateEmployeeMonthlySalary(6, 6, 2025);
    expect(result!.managerLadderPremium).toBe(0);
    expect(result!.ladderPremiumEnabled).toBe(false);
  });

  it('skips managerBonusShare when managerBonusShareEnabled is false', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...manager,
      managerBonusShareEnabled: false,
    });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockExpenseAggregates({ managerBonusBase: 30000 });
    const result = await calculateEmployeeMonthlySalary(6, 6, 2025);
    expect(result!.managerBonusShare).toBe(0);
    expect(result!.managerBonusShareEnabled).toBe(false);
  });
});

describe('calculateEmployeeMonthlySalary — cleaner', () => {
  const cleaner = {
    id: 7,
    name: 'Уборщица Светлана',
    baseSalary: 0,
    employeeType: 'cleaner',
    shiftRate: 5000,
  };

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(cleaner);
    mockExpenseAggregates();
  });

  it('multiplies shiftRate by the number of attendance shifts', async () => {
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(8);
    const result = await calculateEmployeeMonthlySalary(7, 5, 2025);
    expect(result!.attendanceShiftsCount).toBe(8);
    expect(result!.shiftRate).toBe(5000);
    expect(result!.salaryFromShiftRate).toBe(40000);
    expect(result!.totalSalary).toBe(40000);
  });

  it('subtracts advances from the cleaner salary', async () => {
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);
    mockExpenseAggregates({ advances: 5000 });
    const result = await calculateEmployeeMonthlySalary(7, 5, 2025);
    expect(result!.totalSalary).toBe(4 * 5000 - 5000);
  });

  it('adds the fixed allowance on top of the shift-rate salary', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...cleaner, allowance: 10000 });
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(8);
    const result = await calculateEmployeeMonthlySalary(7, 5, 2025);
    expect(result!.allowance).toBe(10000);
    expect(result!.totalSalary).toBe(40000 + 10000);
  });
});

describe('calculateEmployeeMonthlySalary — office', () => {
  const officeEmployee = {
    id: 8,
    name: 'Офис-менеджер Динара',
    baseSalary: 200000,
    employeeType: 'office',
  };

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(officeEmployee);
    mockExpenseAggregates();
  });

  it('computes base salary from attendance via the working calendar', async () => {
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ workingDays: 20 });
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(15);
    vi.mocked(prisma.officePremiumTier.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.mocked(prisma.dailyRevenueEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    });
    const result = await calculateEmployeeMonthlySalary(8, 6, 2025);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo((200000 / 20) * 15, 5);
  });

  it('applies the flat bonus of the matching office tier based on total revenue of all pharmacies', async () => {
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    vi.mocked(prisma.officePremiumTier.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fromAmount: 130000000, toAmount: 150000000, bonusAmount: 10000 },
      { fromAmount: 150000000, toAmount: 170000000, bonusAmount: 20000 },
      { fromAmount: 170000000, toAmount: null, bonusAmount: 30000 },
    ]);
    vi.mocked(prisma.dailyRevenueEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { cashRevenue: 150000000, terminalRevenue: 10000000, kaspiRevenue: 0 },
    });
    const result = await calculateEmployeeMonthlySalary(8, 6, 2025);
    // total = 160,000,000 — falls in the 150-170m tier, flat 20000 (not cumulative with lower tiers)
    expect(result!.managedRevenueTotal).toBe(160000000);
    expect(result!.managerLadderPremium).toBe(20000);
    expect(result!.totalSalary).toBe(20000);
  });

  it('uses the open-ended tier (toAmount null) when revenue exceeds all bounded tiers', async () => {
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    vi.mocked(prisma.officePremiumTier.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fromAmount: 130000000, toAmount: 150000000, bonusAmount: 10000 },
      { fromAmount: 420000000, toAmount: null, bonusAmount: 120000 },
    ]);
    vi.mocked(prisma.dailyRevenueEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { cashRevenue: 500000000, terminalRevenue: 0, kaspiRevenue: 0 },
    });
    const result = await calculateEmployeeMonthlySalary(8, 6, 2025);
    expect(result!.managerLadderPremium).toBe(120000);
  });

  it('returns 0 premium when revenue does not fall into any tier', async () => {
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    vi.mocked(prisma.officePremiumTier.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fromAmount: 130000000, toAmount: 150000000, bonusAmount: 10000 },
    ]);
    vi.mocked(prisma.dailyRevenueEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { cashRevenue: 1000000, terminalRevenue: 0, kaspiRevenue: 0 },
    });
    const result = await calculateEmployeeMonthlySalary(8, 6, 2025);
    expect(result!.managerLadderPremium).toBe(0);
  });

  it('adds the fixed allowance on top of attendance salary and ladder premium', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...officeEmployee, allowance: 8000 });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    vi.mocked(prisma.officePremiumTier.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.mocked(prisma.dailyRevenueEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { cashRevenue: 0, terminalRevenue: 0, kaspiRevenue: 0 },
    });
    const result = await calculateEmployeeMonthlySalary(8, 6, 2025);
    expect(result!.allowance).toBe(8000);
    expect(result!.totalSalary).toBe(8000);
  });
});

describe('calculateEmployeeMonthlySalary — pharmacy_manager', () => {
  const manager = {
    id: 9,
    name: 'Менеджер Олжас',
    baseSalary: 180000,
    employeeType: 'pharmacy_manager',
    pharmacies: [{ employeeId: 9, pharmacyId: 12 }],
    ladderPremiumEnabled: false,
    managerBonusShareEnabled: false,
  };

  beforeEach(() => {
    mockExpenseAggregates();
  });

  it('computes salary purely from attendance/working calendar when premium is disabled', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(manager);
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ workingDays: 18 });
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(9);
    mockManagedPharmacies([{ id: 12, managerPremiumThreshold: 100000, managerPremiumBase: 5000 }]);
    mockRevenueEntries({
      pharmacyRevenueRows: [{ pharmacyId: 12, cashRevenue: 999999, terminalRevenue: 0, kaspiRevenue: 0 }],
    });

    const result = await calculateEmployeeMonthlySalary(9, 6, 2025);
    expect(result!.salaryFromFiveDayShifts).toBeCloseTo((180000 / 18) * 9, 5);
    // премия выключена — лестница аптеки не должна считаться, даже если выручка выше порога
    expect(result!.managerLadderPremium).toBe(0);
    expect(result!.ladderPremiumEnabled).toBe(false);
    expect(result!.managerBonusShare).toBe(0);
    expect(result!.allowance).toBe(0);
    expect(result!.totalSalary).toBeCloseTo((180000 / 18) * 9, 5);
  });

  it('applies the pharmacy ladder premium when ladderPremiumEnabled is true', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...manager,
      ladderPremiumEnabled: true,
    });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockManagedPharmacies([
      { id: 12, managerPremiumThreshold: 100000, managerPremiumBase: 5000, managerPremiumStepAmount: 50000, managerPremiumStepBonus: 1000 },
    ]);
    mockRevenueEntries({
      pharmacyRevenueRows: [{ pharmacyId: 12, cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0 }],
    });

    const result = await calculateEmployeeMonthlySalary(9, 6, 2025);
    // (200000-100000)/50000 = 2 шага * 1000 = 2000 + база 5000 = 7000
    expect(result!.ladderPremiumEnabled).toBe(true);
    expect(result!.managerLadderPremium).toBeCloseTo(7000, 5);
    expect(result!.managedRevenueTotal).toBe(200000);
    expect(result!.totalSalary).toBeCloseTo(7000, 5);
  });

  it('also applies the 10% bonus share when managerBonusShareEnabled is true, independently of the ladder', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...manager,
      ladderPremiumEnabled: false,
      managerBonusShareEnabled: true,
    });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockManagedPharmacies([{ id: 12, managerPremiumThreshold: 100000, managerPremiumBase: 5000 }]);
    mockExpenseAggregates({ managerBonusBase: 40000 });
    mockRevenueEntries({
      pharmacyRevenueRows: [{ pharmacyId: 12, cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0 }],
    });

    const result = await calculateEmployeeMonthlySalary(9, 6, 2025);
    expect(result!.managerBonusShareEnabled).toBe(true);
    expect(result!.managerBonusShare).toBeCloseTo(4000, 5);
    // лестница выключена — выручка выше порога, но премии быть не должно
    expect(result!.managerLadderPremium).toBe(0);
    expect(result!.totalSalary).toBeCloseTo(4000, 5);
  });

  it('is included by calculateAllEmployeesSalaries even with zero attendance this month', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 9, name: 'Менеджер Олжас', baseSalary: 180000, isActive: true },
    ]);
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...manager,
      ladderPremiumEnabled: true,
    });
    vi.mocked(prisma.workingCalendar.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.mocked(prisma.attendanceShift.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    mockManagedPharmacies([{ id: 12, managerPremiumThreshold: 100000, managerPremiumBase: 5000 }]);
    mockRevenueEntries({
      pharmacyRevenueRows: [{ pharmacyId: 12, cashRevenue: 200000, terminalRevenue: 0, kaspiRevenue: 0 }],
    });

    const result = await calculateAllEmployeesSalaries(6, 2025);
    expect(result).toHaveLength(1);
    expect(result[0].recordsCount).toBe(0);
    expect(result[0].managerLadderPremium).toBeCloseTo(5000, 5);
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
