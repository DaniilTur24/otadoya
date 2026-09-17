import { prisma } from '@/lib/prisma';
import { isCalendarProratedEmployee } from '@/lib/employee-types';

/**
 * Симметричная проверка к validateNoAttendanceOnDate (revenue-validation.ts): не даёт отметить
 * табель на дату, где у сотрудника уже есть смена в записи выручки — актуально для
 * seller_five_day_fixed, у которого разрешены оба источника, но не на одну и ту же дату.
 */
export async function validateNoShiftOnDate(employeeId: number, date: Date): Promise<string | null> {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const existing = await prisma.dailyRevenueEntry.findFirst({
    where: { employeeId, shiftType: { not: null }, status: { not: 'rejected' }, date: { gte: dayStart, lte: dayEnd } },
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

/**
 * Табель сверх производственного календаря для типов с окладом «по норме» (см.
 * isCalendarProratedEmployee): 28 отметок при норме 22 → 200 000 / 22 × 28 = 254 545 ₸, +27% к
 * окладу. Раньше это только подсвечивалось в табеле жёлтым текстом и оставалось на совести того,
 * кто заметит до закрытия месяца (QA раунд 3 №7 / раунд 4 №13). Теперь новая отметка сверх нормы
 * не принимается: переработка фиксируется часами (overtimeHours), а не лишним днём оклада.
 * Если календарь за месяц не заполнен — ограничения нет (это ловит calendarMissing при закрытии).
 */
export async function validateWithinWorkingCalendar(
  employee: { id: number; employeeType: string; fiveDayViaAttendance?: boolean | null },
  year: number,
  month: number,
  newMarksCount: number,
): Promise<string | null> {
  if (newMarksCount <= 0 || !isCalendarProratedEmployee(employee)) return null;
  const calendar = await prisma.workingCalendar.findFirst({ where: { year, month }, select: { workingDays: true } });
  if (!calendar) return null;
  const existing = await prisma.attendanceShift.count({
    where: {
      employeeId: employee.id,
      date: { gte: new Date(year, month - 1, 1), lte: new Date(year, month, 0, 23, 59, 59, 999) },
    },
  });
  if (existing + newMarksCount > calendar.workingDays) {
    return (
      `Норма за месяц — ${calendar.workingDays} рабочих дн., уже отмечено ${existing}. ` +
      `Отметить сверх нормы нельзя — оклад уже выплачен полностью; переработку укажите часами в отметке дня`
    );
  }
  return null;
}
