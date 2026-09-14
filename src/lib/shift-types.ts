// Константы типов смен — безопасны для импорта на клиенте и сервере

export const SHIFT_TYPES = {
  day: 'day',
  full_day: 'full_day',
  full_day_cont: 'full_day_cont',
  five_day: 'five_day',
} as const;

export type ShiftType = keyof typeof SHIFT_TYPES;

export const SHIFT_TYPE_LABELS: Record<string, string> = {
  day: 'Дневная',
  full_day: 'Суточная',
  full_day_cont: 'Продолжение суток',
  five_day: 'Пятидневная',
};

/**
 * Суточная смена начинается в один календарный день, а заканчивается утром следующего — касса
 * при этом снимается по календарным дням, то есть выручка одной смены попадает в две записи.
 * Вторая запись помечается как продолжение: её выручка идёт в премию той же смены, но саму
 * смену не задваивает и не занимает дату (на неё можно поставить табель или новую смену —
 * человек, сдавший сутки утром, в тот же день может начать пятидневку).
 */
export function isShiftContinuation(shiftType: string | null | undefined): boolean {
  return shiftType === SHIFT_TYPES.full_day_cont;
}

// 'five_day' сюда не входит: пятидневка сотрудника с включённым fiveDayViaAttendance назначается
// в табеле посещаемости, а не смену выручки; на зарплату этот тип смены в выручке больше не влияет
// (см. salary-calculator.ts), поэтому в форме внесения выручки его выбирать незачем.
export const SHIFT_OPTIONS = [
  { value: 'day', label: 'Дневная' },
  { value: 'full_day', label: 'Суточная' },
] as const;
