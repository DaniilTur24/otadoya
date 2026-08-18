import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    employee: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { validateShiftEmployeeType } from '@/lib/revenue-validation';

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
    expect(error).toBe('У этого сотрудника пятидневка отмечается в табеле посещаемости, а не записью выручки');
  });

  it('still allows day/full_day shifts for a seller with fiveDayViaAttendance on', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'seller',
      fiveDayViaAttendance: true,
    });
    expect(await validateShiftEmployeeType(1, 'day')).toBeNull();
    expect(await validateShiftEmployeeType(1, 'full_day')).toBeNull();
  });

  it('still blocks attendance-based types regardless of fiveDayViaAttendance', async () => {
    vi.mocked(prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      employeeType: 'office',
      fiveDayViaAttendance: false,
    });
    const error = await validateShiftEmployeeType(1, 'day');
    expect(error).toBe('Этому типу сотрудника нельзя назначить смену в записи выручки — он учитывается через табель посещаемости');
  });
});
