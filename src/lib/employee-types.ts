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
