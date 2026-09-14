// Константы типов смен — безопасны для импорта на клиенте и сервере

export const SHIFT_TYPES = {
  day: 'day',
  full_day: 'full_day',
  five_day: 'five_day',
} as const;

export type ShiftType = keyof typeof SHIFT_TYPES;

export const SHIFT_TYPE_LABELS: Record<string, string> = {
  day: 'Дневная',
  full_day: 'Суточная',
  five_day: 'Пятидневная',
};

// 'five_day' сюда не входит: пятидневка сотрудника с включённым fiveDayViaAttendance назначается
// в табеле посещаемости, а не смену выручки; на зарплату этот тип смены в выручке больше не влияет
// (см. salary-calculator.ts), поэтому в форме внесения выручки его выбирать незачем.
export const SHIFT_OPTIONS = [
  { value: 'day', label: 'Дневная' },
  { value: 'full_day', label: 'Суточная' },
] as const;
