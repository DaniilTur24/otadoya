import { prisma } from '@/lib/prisma';
import { ATTENDANCE_BASED_TYPES, canGetRevenueShift } from '@/lib/employee-types';
import { REVENUE_ITEM_CATEGORIES, monthlyFieldLabel } from '@/lib/monthly-report-fields';

/**
 * Типы смены, которые принимает запись выручки. 'five_day' в форме давно не предлагается
 * (SHIFT_OPTIONS в shift-types.ts) и зарплату не даёт, но занимал бы день для другой смены —
 * поэтому сервер его тоже не принимает (QA раунд 4, №17).
 */
export const REVENUE_SHIFT_TYPES: ReadonlySet<string> = new Set(['day', 'full_day']);

export function validateShiftTypeValue(shiftType: unknown): string | null {
  if (shiftType == null || shiftType === '') return null;
  if (typeof shiftType !== 'string' || !REVENUE_SHIFT_TYPES.has(shiftType)) {
    return 'Недопустимый тип смены';
  }
  return null;
}

/**
 * Категория строки расхода — только из списка, который предлагает форма. Пустая (null) допустима:
 * такие строки уходят в «Прочие расходы».
 */
export function validateExpenseItemCategories(items: { category?: string | null }[]): string | null {
  for (const item of items) {
    if (item.category == null || item.category === '') continue;
    if (typeof item.category !== 'string' || !REVENUE_ITEM_CATEGORIES.has(item.category)) {
      return `Недопустимая статья расхода: ${monthlyFieldLabel(String(item.category))}`;
    }
  }
  return null;
}

/**
 * Сотрудники с табельной оплатой (manager_fixed/cleaner/office/pharmacy_manager) не должны
 * получать смену в записи выручки — их зарплата считается только по AttendanceShift, а смена
 * в выручке не ограничена количеством рабочих дней и может задвоить/накрутить оплату при смене типа.
 * Исключение — seller_five_day_fixed: ему смена разрешена, конфликт на конкретную дату
 * с уже отмеченным табелем проверяется отдельно, см. validateNoAttendanceOnDate.
 */
export async function validateShiftEmployeeType(employeeId: number, shiftType: string | null): Promise<string | null> {
  if (!employeeId || !shiftType) return null;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeType: true, fiveDayViaAttendance: true },
  });
  if (!employee || canGetRevenueShift(employee)) return null;
  if (ATTENDANCE_BASED_TYPES.has(employee.employeeType)) {
    return 'Этому типу сотрудника нельзя назначить смену в записи выручки — он учитывается через табель посещаемости';
  }
  // Продавец с включённым fiveDayViaAttendance всегда работает по пятидневному графику —
  // его зарплата считается только по табелю. Смена любого типа (день/сутки/пятидневка) в
  // записи выручки задвоила бы оплату за тот же день; сама выручка при этом заносится как обычно,
  // просто без привязки к смене этого сотрудника.
  return 'У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смену в записи выручки ему назначать нельзя';
}

/**
 * seller_five_day_fixed может получать и смену в выручке, и отметку табеля — но не обе на одну
 * и ту же дату, иначе оплата за этот день задвоится (сменная часть + фиксированная за табель).
 * Для остальных типов не актуально: им либо смена, либо табель разрешены полностью (см.
 * validateShiftEmployeeType), так что конфликтующей отметки табеля у них в принципе не бывает.
 */
export async function validateNoAttendanceOnDate(
  employeeId: number,
  date: Date,
  shiftType: string | null,
): Promise<string | null> {
  if (!employeeId || !shiftType) return null;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const existing = await prisma.attendanceShift.findFirst({
    where: { employeeId, date: { gte: dayStart, lte: dayEnd } },
  });
  if (existing) {
    return 'На эту дату у сотрудника уже отмечен табель — нельзя также назначить смену в записи выручки';
  }
  return null;
}

/**
 * Один сотрудник физически не может отработать больше одной смены в день — без этой проверки
 * можно было бы создать несколько записей с одной датой и неограниченно накрутить сменную зарплату
 * (baseSalary/10 или /15 за каждую запись), в отличие от табеля, где на дату действует unique-ограничение.
 */
export async function validateUniqueShift(
  employeeId: number,
  date: Date,
  shiftType: string | null,
  excludeId?: number,
): Promise<string | null> {
  if (!employeeId || !shiftType) return null;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const existing = await prisma.dailyRevenueEntry.findFirst({
    where: {
      employeeId,
      shiftType: { not: null },
      // Отклонённая запись (устаревший статус, новых больше не создаётся) — не смена: иначе
      // после отклонения заведующая не могла ни исправить её, ни внести новую за этот день.
      status: { not: 'rejected' },
      date: { gte: dayStart, lte: dayEnd },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    return 'У этого сотрудника уже есть смена на эту дату — нельзя назначить вторую';
  }
  return null;
}

/**
 * Получатель аванса/доплаты (employeeAdvance/employeeSurcharge) должен работать в аптеке этой
 * записи — кроме office: офисные сотрудники получают деньги из кассы любой аптеки, а не только
 * своей, поэтому привязка через EmployeePharmacy для них не проверяется.
 */
export async function validateRecipientPharmacy(
  recipientEmployeeIds: number[],
  pharmacyId: number,
): Promise<string | null> {
  if (recipientEmployeeIds.length === 0) return null;
  const recipients = await prisma.employee.findMany({
    where: { id: { in: recipientEmployeeIds } },
    select: { id: true, employeeType: true },
  });
  const idsNeedingLink = recipients.filter((r) => r.employeeType !== 'office').map((r) => r.id);
  if (idsNeedingLink.length === 0) return null;
  const links = await prisma.employeePharmacy.findMany({
    where: { employeeId: { in: idsNeedingLink }, pharmacyId },
    select: { employeeId: true },
  });
  const linkedIds = new Set(links.map((l) => l.employeeId));
  if (idsNeedingLink.some((id) => !linkedIds.has(id))) {
    return 'Аванс/доплату можно записать только сотруднику выбранной аптеки';
  }
  return null;
}

export function validateNonNegativeAmounts(amounts: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(amounts)) {
    if (value != null && Number(value) < 0) {
      return `Поле "${key}" не может быть отрицательным`;
    }
  }
  return null;
}
