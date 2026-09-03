import { prisma } from '@/lib/prisma';

/**
 * Симметричная проверка к validateNoAttendanceOnDate (revenue-validation.ts): не даёт отметить
 * табель на дату, где у сотрудника уже есть смена в записи выручки — актуально для
 * seller_five_day_fixed, у которого разрешены оба источника, но не на одну и ту же дату.
 */
export async function validateNoShiftOnDate(employeeId: number, date: Date): Promise<string | null> {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const existing = await prisma.dailyRevenueEntry.findFirst({
    where: { employeeId, shiftType: { not: null }, date: { gte: dayStart, lte: dayEnd } },
  });
  if (existing) {
    return 'На эту дату у сотрудника уже назначена смена в записи выручки — нельзя также отметить табель';
  }
  return null;
}
