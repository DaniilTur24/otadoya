import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyRevenueEntry: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { validateNoShiftOnDate } from '@/lib/attendance-validation';

describe('validateNoShiftOnDate', () => {
  it('allows the attendance mark when there is no revenue shift on that date', async () => {
    vi.mocked(prisma.dailyRevenueEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await validateNoShiftOnDate(1, new Date('2026-06-15'))).toBeNull();
  });

  it('blocks the attendance mark when the employee already has a revenue shift that date', async () => {
    vi.mocked(prisma.dailyRevenueEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
    const error = await validateNoShiftOnDate(1, new Date('2026-06-15'));
    expect(error).toBe('На эту дату у сотрудника уже назначена смена в записи выручки — нельзя также отметить табель');
  });
});

describe('validateNoShiftOnDate — продолжение суточной смены', () => {
  it('исключает продолжение суток из запроса: дату оно не занимает', async () => {
    // Сотрудник сдал сутки утром 2-го и в тот же день вышел на пятидневку — табель должен встать.
    const findFirst = vi.mocked(prisma.dailyRevenueEntry.findFirst as ReturnType<typeof vi.fn>);
    findFirst.mockResolvedValue(null);

    await validateNoShiftOnDate(1, new Date('2026-06-15'));

    const where = findFirst.mock.calls[findFirst.mock.calls.length - 1][0].where;
    expect(where.shiftType).toEqual({ not: null, notIn: ['full_day_cont'] });
  });
});
