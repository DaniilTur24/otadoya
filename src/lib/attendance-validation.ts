import { prisma } from '@/lib/prisma';

function dayBounds(date: Date): { gte: Date; lte: Date } {
  return {
    gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    lte: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999),
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU');
}

/**
 * Зеркало validateNoAttendanceOnDate из revenue-validation: один и тот же день нельзя оплатить
 * и как смену в записи выручки (оклад/10 или /15), и как отметку табеля (оклад/рабочие дни).
 *
 * Проверка нужна с обеих сторон, потому что при смешанном графике оба канала открыты одному
 * человеку одновременно и записи создаются независимо друг от друга.
 */
export async function findShiftOnDate(employeeId: number, date: Date): Promise<string | null> {
  const existing = await prisma.dailyRevenueEntry.findFirst({
    where: { employeeId, shiftType: { not: null }, date: dayBounds(date) },
  });
  if (existing) {
    return 'На эту дату у сотрудника уже есть смена в записи выручки — один день нельзя оплатить и как смену, и как пятидневку';
  }
  return null;
}

/**
 * То же для реконсиляции целого месяца (PUT /api/attendance/bulk): выделение диапазона в сетке
 * табеля пришло бы одним запросом, и без проверки всего набора сразу конфликтный день проскочил бы.
 * Проверяются только новые даты — уже существующие отметки трогать не нужно.
 */
export async function findShiftsOnDates(
  employeeId: number,
  dates: Date[],
  monthStart: Date,
  monthEnd: Date,
): Promise<string | null> {
  if (dates.length === 0) return null;

  const shifts = await prisma.dailyRevenueEntry.findMany({
    where: { employeeId, shiftType: { not: null }, date: { gte: monthStart, lte: monthEnd } },
    select: { date: true },
  });
  if (shifts.length === 0) return null;

  const shiftDays = new Set(shifts.map((s) => new Date(s.date).toDateString()));
  const conflicts = dates.filter((d) => shiftDays.has(d.toDateString()));
  if (conflicts.length > 0) {
    const listed = conflicts.slice(0, 5).map(formatDate).join(', ');
    const tail = conflicts.length > 5 ? ` и ещё ${conflicts.length - 5}` : '';
    return `В эти дни у сотрудника уже есть смена в записи выручки: ${listed}${tail}. Один день нельзя оплатить и как смену, и как пятидневку`;
  }
  return null;
}
