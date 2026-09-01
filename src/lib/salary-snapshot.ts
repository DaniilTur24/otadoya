import { prisma } from '@/lib/prisma';
import { calculateEmployeeMonthlySalary, type MonthlySalaryResult } from '@/lib/salary-calculator';
import { resolveWorkSchedule } from '@/lib/employee-types';

/**
 * Зарплата нигде не хранится — она пересчитывается из ТЕКУЩИХ настроек (оклад, рабочий
 * календарь, пороги премии аптеки, переключатели). Пока месяц открыт это правильно: данные
 * ещё уточняются. Но после закрытия месяца цифры должны замереть, иначе повышение оклада
 * или правка календаря задним числом изменят сумму за период, за который уже выплачено.
 *
 * Отчёт по аптекам замораживается снимком с самого начала (ClosedMonth.snapshotJson).
 * Здесь то же самое делается для разбивки по сотрудникам: при закрытии месяца результат
 * расчёта каждого сотрудника сохраняется в тот же снимок, а карточка сотрудника за закрытый
 * месяц читает сохранённые числа вместо живого расчёта.
 *
 * Списки смен, отметок табеля, авансов и доплат в снимок НЕ попадают — это реальные строки
 * в БД, и запись в закрытый месяц запрещена (см. closed-month.ts), поэтому они и так неизменны.
 * Замораживать нужно только вычисляемые суммы.
 */

export interface StoredSalary extends MonthlySalaryResult {
  /** null — расчёт по всем аптекам; число — расчёт, отфильтрованный по этой аптеке */
  pharmacyId: number | null;
}

export interface MonthSnapshot {
  pharmacies: Record<string, Record<string, number>>;
  employees: StoredSalary[];
}

/**
 * Версия формата снимка.
 *  1 (или отсутствие поля) — только аптеки, без зарплат
 *  2 — добавлена секция зарплат сотрудников
 *  3 — у зарплат появились workSchedule и fiveDaySalary (график и второй оклад)
 */
const SNAPSHOT_VERSION = 3;

/**
 * Дописывает поля, которых не было в снимках версии 2. Без этого карточка за уже закрытый
 * месяц получила бы workSchedule = undefined и спрятала бы разом и смены, и табель.
 * Значения выводятся так же, как для карточек без явного графика.
 */
function withDerivedSchedule(stored: StoredSalary): StoredSalary {
  if (stored.workSchedule && stored.fiveDaySalary !== undefined) return stored;
  return {
    ...stored,
    workSchedule: stored.workSchedule ?? resolveWorkSchedule({ employeeType: stored.employeeType }),
    fiveDaySalary: stored.fiveDaySalary ?? stored.baseSalary,
  };
}

/**
 * Считает зарплату всех активных сотрудников на момент закрытия месяца.
 *
 * Для каждого сотрудника сохраняются и общий расчёт (по всем аптекам), и расчёт по каждой
 * привязанной аптеке — карточка сотрудника умеет фильтровать по аптеке, и без этих вариантов
 * закрытый месяц пришлось бы считать вживую именно в том разрезе, ради которого всё и замораживалось.
 *
 * В отличие от calculateAllEmployeesSalaries здесь НЕ отбрасываются сотрудники без записей:
 * снимок должен отвечать на любой запрос, включая «ноль смен за месяц», иначе такой сотрудник
 * провалится в живой расчёт и его цифры поедут.
 */
export async function buildEmployeeSalarySnapshot(year: number, month: number): Promise<StoredSalary[]> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, pharmacies: { select: { pharmacyId: true } } },
    orderBy: { id: 'asc' },
  });

  const stored: StoredSalary[] = [];
  for (const emp of employees) {
    const overall = await calculateEmployeeMonthlySalary(emp.id, month, year);
    if (overall) stored.push({ ...overall, pharmacyId: null });

    for (const { pharmacyId } of emp.pharmacies) {
      const scoped = await calculateEmployeeMonthlySalary(emp.id, month, year, pharmacyId);
      if (scoped) stored.push({ ...scoped, pharmacyId });
    }
  }
  return stored;
}

export function serializeSnapshot(
  pharmacies: Record<string, Record<string, number>>,
  employees: StoredSalary[],
): string {
  return JSON.stringify({ version: SNAPSHOT_VERSION, pharmacies, employees });
}

/**
 * Читает снимок закрытого месяца. Снимки, сделанные до появления зарплатной секции, — это
 * сам объект аптек без обёртки; они возвращаются с пустым списком сотрудников, и карточка
 * для таких месяцев продолжает считать вживую, как считала раньше.
 */
export function parseSnapshot(json: string): MonthSnapshot {
  const parsed = JSON.parse(json) as unknown;
  if (parsed && typeof parsed === 'object' && typeof (parsed as MonthSnapshot & { version?: unknown }).version === 'number') {
    const snapshot = parsed as MonthSnapshot;
    return {
      pharmacies: snapshot.pharmacies ?? {},
      employees: (snapshot.employees ?? []).map(withDerivedSchedule),
    };
  }
  return { pharmacies: (parsed ?? {}) as Record<string, Record<string, number>>, employees: [] };
}

/**
 * Находит сохранённый расчёт. pharmacyId должен совпасть точно: расчёт «по всем аптекам»
 * (null) и расчёт по конкретной аптеке — это разные суммы, подменять одно другим нельзя.
 */
export function findStoredSalary(
  employees: StoredSalary[],
  employeeId: number,
  pharmacyId: number | null,
): StoredSalary | null {
  return employees.find((e) => e.employeeId === employeeId && (e.pharmacyId ?? null) === pharmacyId) ?? null;
}
