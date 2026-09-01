import { describe, it, expect } from 'vitest';
import {
  resolveWorkSchedule,
  usesAttendance,
  usesRevenueShifts,
  ATTENDANCE_BASED_TYPES,
} from '@/lib/employee-types';

/**
 * Вывод графика — единственное место, где старые карточки (у них workSchedule = NULL)
 * продолжают вести себя как раньше. Если он сломается, у существующих сотрудников
 * молча поменяется формула расчёта, поэтому проверяется каждый случай отдельно.
 */
describe('resolveWorkSchedule — вывод для карточек без явного графика', () => {
  it('табельные типы получают пятидневку', () => {
    for (const employeeType of ATTENDANCE_BASED_TYPES) {
      expect(resolveWorkSchedule({ employeeType, workSchedule: null })).toBe('five_day');
    }
  });

  it('продавец и торгующая заведующая получают сменный график', () => {
    expect(resolveWorkSchedule({ employeeType: 'seller', workSchedule: null })).toBe('shift');
    expect(resolveWorkSchedule({ employeeType: 'manager_trading', workSchedule: null })).toBe('shift');
  });

  // fiveDayViaAttendance выводится именно в mixed, а не в five_day: у такого сотрудника
  // расчёт и раньше читал записи выручки (оттуда шли pharmaBonus и общая выручка), тогда как
  // у manager_fixed не читал вовсе. Свести оба в один график значило бы отнять бонусы у одного
  // из них — суммы за прошлые месяцы поехали бы.
  it('старый флаг fiveDayViaAttendance выводится в смешанный график', () => {
    expect(resolveWorkSchedule({ employeeType: 'seller', workSchedule: null, fiveDayViaAttendance: true })).toBe('mixed');
    expect(resolveWorkSchedule({ employeeType: 'manager_trading', workSchedule: null, fiveDayViaAttendance: true })).toBe('mixed');
  });

  it('у табельных типов старый флаг ничего не меняет', () => {
    expect(resolveWorkSchedule({ employeeType: 'office', workSchedule: null, fiveDayViaAttendance: true })).toBe('five_day');
  });

  it('отсутствующий workSchedule и undefined трактуются одинаково', () => {
    expect(resolveWorkSchedule({ employeeType: 'seller' })).toBe('shift');
    expect(resolveWorkSchedule({ employeeType: 'seller', workSchedule: undefined })).toBe('shift');
  });
});

describe('resolveWorkSchedule — явно выбранный график', () => {
  it('перекрывает и тип сотрудника, и старый флаг', () => {
    expect(resolveWorkSchedule({ employeeType: 'office', workSchedule: 'shift' })).toBe('shift');
    expect(resolveWorkSchedule({ employeeType: 'seller', workSchedule: 'five_day', fiveDayViaAttendance: true })).toBe('five_day');
    expect(resolveWorkSchedule({ employeeType: 'manager_fixed', workSchedule: 'mixed' })).toBe('mixed');
  });

  it('мусорное значение игнорируется и график выводится как обычно', () => {
    expect(resolveWorkSchedule({ employeeType: 'seller', workSchedule: 'weekly' })).toBe('shift');
    expect(resolveWorkSchedule({ employeeType: 'cleaner', workSchedule: '' })).toBe('five_day');
  });
});

describe('какие каналы открыты каждому графику', () => {
  it('сменный — только записи выручки', () => {
    expect(usesRevenueShifts('shift')).toBe(true);
    expect(usesAttendance('shift')).toBe(false);
  });

  it('пятидневка — только табель', () => {
    expect(usesRevenueShifts('five_day')).toBe(false);
    expect(usesAttendance('five_day')).toBe(true);
  });

  it('смешанный — оба сразу', () => {
    expect(usesRevenueShifts('mixed')).toBe(true);
    expect(usesAttendance('mixed')).toBe(true);
  });
});
