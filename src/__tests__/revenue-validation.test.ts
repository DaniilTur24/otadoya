import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const FIVE_DAY_ERROR =
  'У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смену в записи выручки ему назначать нельзя';

describe('validateShiftEmployeeType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a plain seller to get a five_day shift', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      workSchedule: null,
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'five_day')).toBeNull();
  });

  // fiveDayViaAttendance выводится в смешанный график: у такого сотрудника расчёт и раньше
  // читал записи выручки, просто смену в них назначать было нельзя. Теперь — можно, а от
  // двойной оплаты одного дня защищает validateNoAttendanceOnDate.
  it('allows shifts for a legacy fiveDayViaAttendance employee (now a mixed schedule)', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      workSchedule: null,
      fiveDayViaAttendance: true,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBeNull();
    expect(await validateShiftEmployeeType(1, 'full_day')).toBeNull();
  });

  it('blocks shifts when the schedule is explicitly five_day', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      workSchedule: 'five_day',
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBe(FIVE_DAY_ERROR);
  });

  it('allows shifts when the schedule is explicitly mixed, even for an attendance-based type', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'manager_fixed',
      workSchedule: 'mixed',
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBeNull();
  });

  it('still blocks attendance-based types when no schedule was chosen', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'office',
      workSchedule: null,
      fiveDayViaAttendance: false,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBe(FIVE_DAY_ERROR);
  });
});

describe('validateNoAttendanceOnDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a shift on a date that already has an attendance mark', async () => {
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 7 });
    const error = await validateNoAttendanceOnDate(1, new Date(2026, 8, 10), 'day');
    expect(error).toBe(
      'На эту дату у сотрудника уже стоит отметка в табеле — один день нельзя оплатить и как смену, и как пятидневку'
    );
  });

  it('allows a shift when the date is free in the timesheet', async () => {
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await validateNoAttendanceOnDate(1, new Date(2026, 8, 10), 'day')).toBeNull();
  });

  // Запись выручки без смены зарплату не начисляет — конфликта с табелем у неё нет,
  // и лишний запрос в БД на каждое сохранение выручки делать незачем.
  it('skips the check entirely when the entry carries no shift', async () => {
    expect(await validateNoAttendanceOnDate(1, new Date(2026, 8, 10), null)).toBeNull();
    expect(prisma.attendanceShift.findFirst).not.toHaveBeenCalled();
  });

  it('bounds the lookup to the calendar day of the shift', async () => {
    vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await validateNoAttendanceOnDate(1, new Date(2026, 8, 10, 15, 30), 'full_day');

    const call = vi.mocked(prisma.attendanceShift.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.date.gte).toEqual(new Date(2026, 8, 10, 0, 0, 0, 0));
    expect(call.where.date.lte).toEqual(new Date(2026, 8, 10, 23, 59, 59, 999));
  });
});
