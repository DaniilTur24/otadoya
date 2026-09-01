import { prisma } from '@/lib/prisma';

/**
 * Закрытый месяц — это «цифры финальные». Любая запись, которая влияет на расчёт за такой
 * месяц, должна отклоняться с 423, иначе снимок отчёта расходится с живыми данными.
 *
 * Проверка вынесена сюда, потому что раньше она жила приватной функцией только в маршруте
 * выручки — из-за чего табель и производственный календарь остались без неё вовсе и позволяли
 * менять уже закрытый период.
 */
export async function isYearMonthClosed(year: number, month: number): Promise<boolean> {
  const closed = await prisma.closedMonth.findUnique({ where: { year_month: { year, month } } });
  return !!closed;
}

export async function isMonthClosed(date: Date): Promise<boolean> {
  return isYearMonthClosed(date.getFullYear(), date.getMonth() + 1);
}
