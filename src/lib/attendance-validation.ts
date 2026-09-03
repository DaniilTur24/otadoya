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

/**
 * Табель — это отметка уже отработанного дня, не план на будущее. Без этой проверки можно
 * было отметить смену наперёд на месяцы вперёд — она сразу считалась бы в зарплату, хотя
 * человек ещё не отработал этот день.
 */
export function validateNotFutureDate(date: Date): string | null {
  const today = new Date();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  if (date.getTime() > todayEnd.getTime()) {
    return 'Нельзя отметить табель будущей датой — только уже отработанный день';
  }
  return null;
}

/**
 * Сотрудник должен быть привязан к аптеке, за которую ему отмечают табель — иначе отметка
 * начисляет зарплату по норме, к которой сотрудник формально не имеет отношения, и искажает
 * данные для отчёта по этой аптеке. Тот же принцип уже применяется к получателю аванса/доплаты
 * в записи выручки (revenue/route.ts) — здесь симметричная проверка для табеля.
 */
export async function validateEmployeePharmacyLink(employeeId: number, pharmacyId: number): Promise<string | null> {
  const link = await prisma.employeePharmacy.findFirst({
    where: { employeeId, pharmacyId },
  });
  if (!link) {
    return 'Сотрудник не привязан к этой аптеке — отметить табель нельзя';
  }
  return null;
}
