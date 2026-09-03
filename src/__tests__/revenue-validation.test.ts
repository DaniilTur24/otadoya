import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
    },
    attendanceShift: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { validateShiftEmployeeType, validateNoAttendanceOnDate } from '@/lib/revenue-validation';

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

  it('blocks manager_trading once fiveDayViaAttendance is on — same rule as seller', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'manager_trading',
      fiveDayViaAttendance: true,
    });
    const error = await validateShiftEmployeeType(1, 'full_day');
    expect(error).toBe('У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смену в записи выручки ему назначать нельзя');
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
