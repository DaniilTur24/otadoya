import { prisma } from '@/lib/prisma';
import { ATTENDANCE_BASED_TYPES } from '@/lib/employee-types';

/**
 * Сотрудники с табельной оплатой (manager_fixed/cleaner/office/pharmacy_manager) не должны
 * получать смену в записи выручки — их зарплата считается только по AttendanceShift, а смена
 * в выручке не ограничена количеством рабочих дней и может задвоить/накрутить оплату при смене типа.
 */
export async function validateShiftEmployeeType(employeeId: number, shiftType: string | null): Promise<string | null> {
  if (!employeeId || !shiftType) return null;
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeType: true } });
  if (employee && ATTENDANCE_BASED_TYPES.has(employee.employeeType)) {
    return 'Этому типу сотрудника нельзя назначить смену в записи выручки — он учитывается через табель посещаемости';
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
