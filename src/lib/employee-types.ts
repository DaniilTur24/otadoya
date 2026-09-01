// Константы типов сотрудников — безопасны для импорта на клиенте и сервере

export const EMPLOYEE_TYPES = {
  seller: 'seller',
  manager_trading: 'manager_trading',
  manager_fixed: 'manager_fixed',
  cleaner: 'cleaner',
  office: 'office',
  pharmacy_manager: 'pharmacy_manager',
} as const;

export type EmployeeType = keyof typeof EMPLOYEE_TYPES;

export const EMPLOYEE_TYPE_LABELS: Record<string, string> = {
  seller: 'На кассе',
  manager_trading: 'Заведующая (торгует)',
  manager_fixed: 'Заведующая (не торгует)',
  cleaner: 'Уборщица',
  office: 'Офис',
  pharmacy_manager: 'Менеджер',
};

export const EMPLOYEE_TYPE_OPTIONS = [
  { value: 'seller', label: 'На кассе' },
  { value: 'manager_trading', label: 'Заведующая (торгует)' },
  { value: 'manager_fixed', label: 'Заведующая (не торгует)' },
  { value: 'cleaner', label: 'Уборщица' },
  { value: 'office', label: 'Офис' },
  { value: 'pharmacy_manager', label: 'Менеджер' },
] as const;

// Типы, которые отмечаются через табель посещаемости (AttendanceShift),
// а не через смену в записи выручки
export const ATTENDANCE_BASED_TYPES: ReadonlySet<string> = new Set([
  'manager_fixed',
  'cleaner',
  'office',
  'pharmacy_manager',
]);

/**
 * График работы — откуда берутся отработанные дни сотрудника:
 *  - shift    — только смены в записях выручки (день/сутки)
 *  - five_day — только отметки в табеле посещаемости
 *  - mixed    — и то, и другое: один и тот же человек в одни дни выходит на суточную/дневную
 *               смену, в другие — по пятидневке (за них платится отдельный оклад fiveDaySalary)
 */
export const WORK_SCHEDULES = {
  shift: 'shift',
  five_day: 'five_day',
  mixed: 'mixed',
} as const;

export type WorkSchedule = keyof typeof WORK_SCHEDULES;

export const WORK_SCHEDULE_LABELS: Record<WorkSchedule, string> = {
  shift: 'Сменный (сутки/день)',
  five_day: 'Пятидневка (по табелю)',
  mixed: 'Смешанный (смены + пятидневка)',
};

export const WORK_SCHEDULE_OPTIONS = [
  { value: 'shift', label: WORK_SCHEDULE_LABELS.shift },
  { value: 'five_day', label: WORK_SCHEDULE_LABELS.five_day },
  { value: 'mixed', label: WORK_SCHEDULE_LABELS.mixed },
] as const;

function isWorkSchedule(value: unknown): value is WorkSchedule {
  return value === 'shift' || value === 'five_day' || value === 'mixed';
}

/**
 * График сотрудника. Employee.workSchedule заполняется только если админ выбрал его явно;
 * у всех записей, созданных до появления поля, там NULL — и тогда график выводится из старых
 * признаков ровно так, чтобы расчёт остался прежним:
 *
 *  - табельные типы (manager_fixed/cleaner/office/pharmacy_manager) → five_day: их зарплата
 *    и сегодня считается только по табелю, записи выручки для них не читаются вовсе;
 *  - fiveDayViaAttendance у продавца/торгующей заведующей → mixed, а НЕ five_day: у них
 *    расчёт и сегодня читает записи выручки (оттуда берутся pharmaBonus и общая выручка),
 *    просто смену в них назначать было запрещено. Смен там нет, поэтому суммы не меняются;
 *  - все остальные → shift.
 */
export function resolveWorkSchedule(employee: {
  employeeType: string;
  workSchedule?: string | null;
  fiveDayViaAttendance?: boolean | null;
}): WorkSchedule {
  if (isWorkSchedule(employee.workSchedule)) return employee.workSchedule;
  if (ATTENDANCE_BASED_TYPES.has(employee.employeeType)) return 'five_day';
  if (employee.fiveDayViaAttendance) return 'mixed';
  return 'shift';
}

/** Может ли сотрудник получить смену (день/сутки) в записи выручки. */
export function usesRevenueShifts(schedule: WorkSchedule): boolean {
  return schedule === 'shift' || schedule === 'mixed';
}

/** Отмечается ли сотрудник в табеле посещаемости. */
export function usesAttendance(schedule: WorkSchedule): boolean {
  return schedule === 'five_day' || schedule === 'mixed';
}

// Типы, у которых есть фиксированная доплата и два независимых переключателя —
// managerBonusShareEnabled (10%-доля от бонусов аптеки) и ladderPremiumEnabled
// (лестничная премия по выручке аптеки), в любой комбинации
export const MANAGER_TYPES: ReadonlySet<string> = new Set([
  'manager_trading',
  'manager_fixed',
  'pharmacy_manager',
]);

// Типы, создаваемые на странице /users вместе с аккаунтом-логином: их карточка
// Employee создаётся/синхронизируется автоматически, поэтому тип и оклад
// редактируются только там, а не на /employees
export const USER_LINKED_TYPES: ReadonlySet<string> = new Set([
  'manager_trading',
  'manager_fixed',
  'pharmacy_manager',
]);

export const MANAGER_BONUS_SHARE_PERCENT = 0.1;
