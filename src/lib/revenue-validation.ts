import { prisma } from '@/lib/prisma';
import { resolveWorkSchedule, usesRevenueShifts } from '@/lib/employee-types';

/**
 * Смену в записи выручки может получить только сотрудник, чей график её предполагает
 * (shift или mixed). У чисто табельного графика (five_day) зарплата считается только по
 * AttendanceShift: смена в выручке не ограничена количеством рабочих дней и задвоила бы оплату.
 *
 * График берётся из Employee.workSchedule, а если он не выбран — выводится из типа сотрудника
 * и старого флага fiveDayViaAttendance, поэтому для всех записей, созданных до появления
 * смешанного графика, запрет действует ровно как раньше.
 */
export async function validateShiftEmployeeType(employeeId: number, shiftType: string | null): Promise<string | null> {
  if (!employeeId || !shiftType) return null;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeType: true, workSchedule: true, fiveDayViaAttendance: true },
  });
  if (!employee) return null;

  if (!usesRevenueShifts(resolveWorkSchedule(employee))) {
    return 'У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смену в записи выручки ему назначать нельзя';
  }
  return null;
}

/**
 * Один и тот же день нельзя оплатить дважды из двух разных источников.
 *
 * До появления смешанного графика это было невозможно по построению: сотрудник либо получал
 * смены в записях выручки, либо отмечался в табеле, и одно другое исключало. Со смешанным
 * графиком оба канала открыты одному человеку одновременно — и без этой проверки один и тот же
 * день можно было бы провести и сменой, и отметкой табеля, получив за него и сменную оплату
 * (оклад/10 или /15), и пятидневную (оклад/рабочие дни).
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
    return 'На эту дату у сотрудника уже стоит отметка в табеле — один день нельзя оплатить и как смену, и как пятидневку';
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
      date: { gte: dayStart, lte: dayEnd },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    return 'У этого сотрудника уже есть смена на эту дату — нельзя назначить вторую';
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
