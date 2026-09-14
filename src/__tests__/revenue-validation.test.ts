import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    attendanceShift: {
      findFirst: vi.fn(),
    },
    dailyRevenueEntry: {
      findFirst: vi.fn(),
    },
    employeePharmacy: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { validateShiftEmployeeType, validateNoAttendanceOnDate, validateUniqueShift, validateRecipientPharmacy } from '@/lib/revenue-validation';

describe('validateShiftEmployeeType', () => {
  it('allows a plain seller to get a five_day shift (fiveDayViaAttendance off by default)', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'five_day')).toBeNull();
  });

  it('blocks five_day on a revenue entry once fiveDayViaAttendance is on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      fiveDayViaAttendance: true,
    });
    const error = await validateShiftEmployeeType(1, 'five_day');
    expect(error).toBe('У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смену в записи выручки ему назначать нельзя');
  });

  it('also blocks day/full_day shifts for a seller with fiveDayViaAttendance on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      fiveDayViaAttendance: true,
    });
    const error = await validateShiftEmployeeType(1, 'day');
    expect(error).toBe('У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смену в записи выручки ему назначать нельзя');
    expect(await validateShiftEmployeeType(1, 'full_day')).toBe(error);
  });

  it('still blocks attendance-based types regardless of fiveDayViaAttendance', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'office',
      fiveDayViaAttendance: false,
    });
    const error = await validateShiftEmployeeType(1, 'day');
    expect(error).toBe('Этому типу сотрудника нельзя назначить смену в записи выручки — он учитывается через табель посещаемости');
  });

  it('still allows manager_trading a revenue shift once fiveDayViaAttendance is on — mixed schedule, unlike seller', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'manager_trading',
      fiveDayViaAttendance: true,
    });
    expect(await validateShiftEmployeeType(1, 'full_day')).toBeNull();
  });

  it('allows manager_trading a revenue shift when fiveDayViaAttendance is off', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'manager_trading',
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBeNull();
  });

  it('allows seller_five_day_fixed to get a revenue shift — it is not attendance-only', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller_five_day_fixed',
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBeNull();
    expect(await validateShiftEmployeeType(1, 'full_day')).toBeNull();
  });
});

describe('validateNoAttendanceOnDate', () => {
  it('allows the shift when there is no attendance mark on that date', async () => {
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await validateNoAttendanceOnDate(1, new Date('2026-06-15'), 'full_day')).toBeNull();
  });

  it('blocks the shift when the employee already has an attendance mark that date', async () => {
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
    const error = await validateNoAttendanceOnDate(1, new Date('2026-06-15'), 'full_day');
    expect(error).toBe('На эту дату у сотрудника уже отмечен табель — нельзя также назначить смену в записи выручки');
  });

  it('skips the check when there is no shiftType', async () => {
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
    expect(await validateNoAttendanceOnDate(1, new Date('2026-06-15'), null)).toBeNull();
  });
});

describe('validateRecipientPharmacy', () => {
  it('allows a recipient linked to the target pharmacy', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, employeeType: 'seller' }]);
    vi.mocked(prisma.employeePharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ employeeId: 1 }]);
    expect(await validateRecipientPharmacy([1], 5)).toBeNull();
  });

  it('blocks a recipient not linked to the target pharmacy', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, employeeType: 'seller' }]);
    vi.mocked(prisma.employeePharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const error = await validateRecipientPharmacy([1], 5);
    expect(error).toBe('Аванс/доплату можно записать только сотруднику выбранной аптеки');
  });

  it('allows an office employee regardless of pharmacy link — they draw pay from any pharmacy register', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, employeeType: 'office' }]);
    const employeePharmacyFindMany = prisma.employeePharmacy.findMany as ReturnType<typeof vi.fn>;
    employeePharmacyFindMany.mockResolvedValue([]);
    const callsBefore = employeePharmacyFindMany.mock.calls.length;
    expect(await validateRecipientPharmacy([1], 5)).toBeNull();
    // office employees skip the link check entirely — no new query is made for them
    expect(employeePharmacyFindMany.mock.calls.length).toBe(callsBefore);
  });

  it('still checks the link for a non-office recipient in a mixed batch with an office employee', async () => {
    vi.mocked(prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, employeeType: 'office' },
      { id: 2, employeeType: 'seller' },
    ]);
    vi.mocked(prisma.employeePharmacy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const error = await validateRecipientPharmacy([1, 2], 5);
    expect(error).toBe('Аванс/доплату можно записать только сотруднику выбранной аптеки');
  });

  it('skips all checks when there are no recipients', async () => {
    const findMany = prisma.employee.findMany as ReturnType<typeof vi.fn>;
    const callsBefore = findMany.mock.calls.length;
    expect(await validateRecipientPharmacy([], 5)).toBeNull();
    expect(findMany.mock.calls.length).toBe(callsBefore);
  });
});

describe('продолжение суточной смены', () => {
  it('validateNoAttendanceOnDate пропускает продолжение даже при отмеченном табеле', async () => {
    // Сутки начались накануне и уже оплачены — утро второго дня не мешает пятидневке по табелю.
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
    expect(await validateNoAttendanceOnDate(1, new Date('2026-06-15'), 'full_day_cont')).toBeNull();
  });

  it('validateUniqueShift ищет конфликт продолжения только среди продолжений', async () => {
    const findFirst = vi.mocked(prisma.dailyRevenueEntry.findFirst as ReturnType<typeof vi.fn>);
    findFirst.mockResolvedValue(null);

    await validateUniqueShift(1, new Date('2026-06-15'), 'full_day_cont');

    const where = findFirst.mock.calls[findFirst.mock.calls.length - 1][0].where;
    expect(where.shiftType).toBe('full_day_cont');
  });

  it('validateUniqueShift для обычной смены игнорирует продолжения', async () => {
    const findFirst = vi.mocked(prisma.dailyRevenueEntry.findFirst as ReturnType<typeof vi.fn>);
    findFirst.mockResolvedValue(null);

    await validateUniqueShift(1, new Date('2026-06-15'), 'day');

    const where = findFirst.mock.calls[findFirst.mock.calls.length - 1][0].where;
    expect(where.shiftType).toEqual({ not: null, notIn: ['full_day_cont'] });
  });

  it('validateUniqueShift блокирует второе продолжение на ту же дату', async () => {
    vi.mocked(prisma.dailyRevenueEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 5 });
    const error = await validateUniqueShift(1, new Date('2026-06-15'), 'full_day_cont');
    expect(error).toBe('У этого сотрудника уже отмечено продолжение суточной смены на эту дату');
  });
});
