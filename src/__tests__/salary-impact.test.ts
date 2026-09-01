import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: { findUnique: vi.fn() },
    pharmacy: { findUnique: vi.fn() },
    dailyRevenueEntry: { findMany: vi.fn() },
    attendanceShift: { findMany: vi.fn() },
    employeePharmacy: { findMany: vi.fn() },
    closedMonth: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getEmployeeSalaryImpact, getPharmacySalaryImpact } from '@/lib/salary-impact';

const mocked = (fn: unknown) => vi.mocked(fn as ReturnType<typeof vi.fn>);

function d(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

beforeEach(() => {
  // В проекте нет clearMocks в vitest.config — без явного сброса mock.calls накапливаются
  // между кейсами, и проверки «сколько раз вызвано» становятся бессмысленными.
  vi.clearAllMocks();
  mocked(prisma.closedMonth.findMany).mockResolvedValue([]);
  mocked(prisma.dailyRevenueEntry.findMany).mockResolvedValue([]);
  mocked(prisma.attendanceShift.findMany).mockResolvedValue([]);
  mocked(prisma.employeePharmacy.findMany).mockResolvedValue([]);
});

describe('getEmployeeSalaryImpact', () => {
  it('returns null for a missing employee', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue(null);
    expect(await getEmployeeSalaryImpact(404)).toBeNull();
  });

  it('groups revenue shifts and attendance marks by month', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({ employeeType: 'seller', pharmacies: [] });
    mocked(prisma.dailyRevenueEntry.findMany).mockResolvedValue([
      { date: d(2026, 7, 3) }, { date: d(2026, 7, 20) }, { date: d(2026, 8, 1) },
    ]);
    mocked(prisma.attendanceShift.findMany).mockResolvedValue([{ date: d(2026, 8, 5) }]);

    const impact = await getEmployeeSalaryImpact(1);

    expect(impact!.totalRecords).toBe(4);
    // Свежие месяцы первыми — бухгалтер смотрит на недавние, а не на прошлогодние
    expect(impact!.months).toEqual([
      { year: 2026, month: 8, shifts: 1, attendance: 1, isClosed: false },
      { year: 2026, month: 7, shifts: 2, attendance: 0, isClosed: false },
    ]);
  });

  it('marks closed months so the dialog can say they will not change', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({ employeeType: 'seller', pharmacies: [] });
    mocked(prisma.dailyRevenueEntry.findMany).mockResolvedValue([{ date: d(2026, 7, 3) }]);
    mocked(prisma.closedMonth.findMany).mockResolvedValue([{ year: 2026, month: 7 }]);

    const impact = await getEmployeeSalaryImpact(1);
    expect(impact!.months[0].isClosed).toBe(true);
  });

  it('counts only approved shifts with a shift type', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({ employeeType: 'seller', pharmacies: [] });
    await getEmployeeSalaryImpact(1);

    const where = mocked(prisma.dailyRevenueEntry.findMany).mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ employeeId: 1, status: 'approved', shiftType: { not: null } });
  });

  it('is empty for an employee with no records at all', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({ employeeType: 'seller', pharmacies: [] });
    const impact = await getEmployeeSalaryImpact(1);
    expect(impact).toEqual({ months: [], totalRecords: 0 });
  });

  // Премия заведующей считается от выручки её аптек, а не от личных смен — месяц без её
  // собственных отметок всё равно пересчитается, и предупредить о нём нужно.
  it('includes pharmacy-revenue months for a manager with no personal records', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({
      employeeType: 'manager_fixed',
      pharmacies: [{ pharmacyId: 7 }],
    });
    mocked(prisma.dailyRevenueEntry.findMany)
      .mockResolvedValueOnce([])                       // личные смены
      .mockResolvedValueOnce([{ date: d(2026, 8, 4) }]); // выручка её аптеки

    const impact = await getEmployeeSalaryImpact(1);

    expect(impact!.months).toEqual([
      { year: 2026, month: 8, shifts: 0, attendance: 0, isClosed: false },
    ]);
    // Записей у неё самой нет — счётчик остаётся нулевым, но месяц в списке есть
    expect(impact!.totalRecords).toBe(0);
  });

  it('does not query pharmacy revenue for a plain seller', async () => {
    mocked(prisma.employee.findUnique).mockResolvedValue({
      employeeType: 'seller',
      pharmacies: [{ pharmacyId: 7 }],
    });
    await getEmployeeSalaryImpact(1);
    expect(mocked(prisma.dailyRevenueEntry.findMany)).toHaveBeenCalledTimes(1);
  });
});

describe('getPharmacySalaryImpact', () => {
  it('returns null for a missing pharmacy', async () => {
    mocked(prisma.pharmacy.findUnique).mockResolvedValue(null);
    expect(await getPharmacySalaryImpact(404)).toBeNull();
  });

  it('splits affected employees into ladder and shift groups', async () => {
    mocked(prisma.pharmacy.findUnique).mockResolvedValue({ id: 3 });
    mocked(prisma.dailyRevenueEntry.findMany).mockResolvedValue([{ date: d(2026, 8, 2) }]);
    mocked(prisma.employeePharmacy.findMany).mockResolvedValue([
      { employee: { id: 1, name: 'Заведующая', employeeType: 'manager_fixed', ladderPremiumEnabled: true } },
      { employee: { id: 2, name: 'Продавец', employeeType: 'seller', ladderPremiumEnabled: false } },
      { employee: { id: 3, name: 'Уборщица', employeeType: 'cleaner', ladderPremiumEnabled: false } },
    ]);

    const impact = await getPharmacySalaryImpact(3);

    expect(impact!.ladderEmployees.map((e) => e.name)).toEqual(['Заведующая']);
    // Средняя выручка за смену касается только тех, чьи смены идут из записей выручки
    expect(impact!.shiftEmployees.map((e) => e.name)).toEqual(['Продавец']);
    expect(impact!.months).toEqual([
      { year: 2026, month: 8, shifts: 1, attendance: 0, isClosed: false },
    ]);
  });

  it('ignores deactivated employees', async () => {
    mocked(prisma.pharmacy.findUnique).mockResolvedValue({ id: 3 });
    await getPharmacySalaryImpact(3);

    const where = mocked(prisma.employeePharmacy.findMany).mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ pharmacyId: 3, employee: { isActive: true } });
  });
});
