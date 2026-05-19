// Константы типов смен — безопасны для импорта на клиенте и сервере

export const SHIFT_TYPES = {
  day: 'day',
  full_day: 'full_day',
} as const;

export type ShiftType = keyof typeof SHIFT_TYPES;

export const SHIFT_TYPE_LABELS: Record<string, string> = {
  day: 'Дневная',
  full_day: 'Суточная',
};

export const SHIFT_OPTIONS = [
  { value: 'day', label: 'Дневная' },
  { value: 'full_day', label: 'Суточная' },
] as const;
