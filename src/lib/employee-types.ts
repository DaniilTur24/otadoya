// Константы типов сотрудников — безопасны для импорта на клиенте и сервере

export const EMPLOYEE_TYPES = {
  seller: 'seller',
  seller_five_day_fixed: 'seller_five_day_fixed',
  manager_trading: 'manager_trading',
  manager_fixed: 'manager_fixed',
  cleaner: 'cleaner',
  office: 'office',
  pharmacy_manager: 'pharmacy_manager',
} as const;

export type EmployeeType = keyof typeof EMPLOYEE_TYPES;

export const EMPLOYEE_TYPE_LABELS: Record<string, string> = {
  seller: 'На кассе',
  seller_five_day_fixed: 'Суточник / пятидневка (фикс)',
  manager_trading: 'Заведующая (торгует)',
  manager_fixed: 'Заведующая (не торгует)',
  cleaner: 'Уборщица',
  office: 'Офис',
  pharmacy_manager: 'Менеджер',
};

export const EMPLOYEE_TYPE_OPTIONS = [
  { value: 'seller', label: 'На кассе' },
  { value: 'seller_five_day_fixed', label: 'Суточник / пятидневка (фикс)' },
  { value: 'manager_trading', label: 'Заведующая (торгует)' },
  { value: 'manager_fixed', label: 'Заведующая (не торгует)' },
  { value: 'cleaner', label: 'Уборщица' },
  { value: 'office', label: 'Офис' },
  { value: 'pharmacy_manager', label: 'Менеджер' },
] as const;

// Типы, которые отмечаются ТОЛЬКО через табель посещаемости (AttendanceShift) — смена в
// записи выручки им запрещена полностью. seller_five_day_fixed сюда НЕ входит: у него оба
// источника разрешены одновременно (см. canGetRevenueShift/canMarkAttendance ниже).
export const ATTENDANCE_BASED_TYPES: ReadonlySet<string> = new Set([
  'manager_fixed',
  'cleaner',
  'office',
  'pharmacy_manager',
]);

// Типы, у которых fiveDayViaAttendance переключает источник смен между DailyRevenueEntry и
// AttendanceShift целиком, на весь месяц сразу (не по датам, в отличие от seller_five_day_fixed).
// Для остальных USER_LINKED_TYPES (manager_fixed/pharmacy_manager) это неприменимо — они и так
// всегда только по табелю.
export const FIVE_DAY_VIA_ATTENDANCE_TYPES: ReadonlySet<string> = new Set(['seller', 'manager_trading']);

/**
 * Может ли сотрудник получить смену (день/сутки) в записи выручки.
 * false для табельных типов и для seller/manager_trading с включённым fiveDayViaAttendance
 * (их пятидневка считается только по табелю). seller_five_day_fixed — исключение: ему можно
 * и то, и другое, конфликт на конкретную дату проверяется отдельно (см. validateNoAttendanceOnDate).
 */
export function canGetRevenueShift(employee: { employeeType: string; fiveDayViaAttendance?: boolean | null }): boolean {
  if (ATTENDANCE_BASED_TYPES.has(employee.employeeType)) return false;
  if (FIVE_DAY_VIA_ATTENDANCE_TYPES.has(employee.employeeType) && Boolean(employee.fiveDayViaAttendance)) return false;
  return true;
}

/**
 * Может ли сотрудник отмечаться в табеле посещаемости (AttendanceShift).
 * Табельные типы — всегда; seller/manager_trading — только если включён fiveDayViaAttendance;
 * seller_five_day_fixed — всегда (это его основной или дополнительный способ учёта смен).
 */
export function canMarkAttendance(employee: { employeeType: string; fiveDayViaAttendance?: boolean | null }): boolean {
  if (ATTENDANCE_BASED_TYPES.has(employee.employeeType)) return true;
  if (employee.employeeType === 'seller_five_day_fixed') return true;
  return FIVE_DAY_VIA_ATTENDANCE_TYPES.has(employee.employeeType) && Boolean(employee.fiveDayViaAttendance);
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
