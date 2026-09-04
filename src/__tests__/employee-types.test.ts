import { describe, it, expect } from 'vitest';
import { canGetRevenueShift, canMarkAttendance } from '@/lib/employee-types';

describe('canGetRevenueShift', () => {
  it('allows a plain seller', () => {
    expect(canGetRevenueShift({ employeeType: 'seller', fiveDayViaAttendance: false })).toBe(true);
  });

  it('blocks a seller with fiveDayViaAttendance on', () => {
    expect(canGetRevenueShift({ employeeType: 'seller', fiveDayViaAttendance: true })).toBe(false);
  });

  it('allows manager_trading by default', () => {
    expect(canGetRevenueShift({ employeeType: 'manager_trading', fiveDayViaAttendance: false })).toBe(true);
  });

  it('still allows manager_trading with fiveDayViaAttendance on — mixed schedule, unlike seller', () => {
    expect(canGetRevenueShift({ employeeType: 'manager_trading', fiveDayViaAttendance: true })).toBe(true);
  });

  it('always allows seller_five_day_fixed regardless of fiveDayViaAttendance', () => {
    expect(canGetRevenueShift({ employeeType: 'seller_five_day_fixed', fiveDayViaAttendance: false })).toBe(true);
    expect(canGetRevenueShift({ employeeType: 'seller_five_day_fixed', fiveDayViaAttendance: true })).toBe(true);
  });

  it.each(['manager_fixed', 'cleaner', 'office', 'pharmacy_manager'])(
    'always blocks attendance-based type %s, ignoring fiveDayViaAttendance',
    (employeeType) => {
      expect(canGetRevenueShift({ employeeType, fiveDayViaAttendance: true })).toBe(false);
      expect(canGetRevenueShift({ employeeType, fiveDayViaAttendance: false })).toBe(false);
    }
  );
});

describe('canMarkAttendance', () => {
  it('blocks a plain seller', () => {
    expect(canMarkAttendance({ employeeType: 'seller', fiveDayViaAttendance: false })).toBe(false);
  });

  it('allows a seller with fiveDayViaAttendance on', () => {
    expect(canMarkAttendance({ employeeType: 'seller', fiveDayViaAttendance: true })).toBe(true);
  });

  it('blocks manager_trading by default', () => {
    expect(canMarkAttendance({ employeeType: 'manager_trading', fiveDayViaAttendance: false })).toBe(false);
  });

  it('allows manager_trading with fiveDayViaAttendance on — same rule as seller', () => {
    expect(canMarkAttendance({ employeeType: 'manager_trading', fiveDayViaAttendance: true })).toBe(true);
  });

  it('always allows seller_five_day_fixed regardless of fiveDayViaAttendance', () => {
    expect(canMarkAttendance({ employeeType: 'seller_five_day_fixed', fiveDayViaAttendance: false })).toBe(true);
    expect(canMarkAttendance({ employeeType: 'seller_five_day_fixed', fiveDayViaAttendance: true })).toBe(true);
  });

  it.each(['manager_fixed', 'cleaner', 'office', 'pharmacy_manager'])(
    'always allows attendance-based type %s, ignoring fiveDayViaAttendance',
    (employeeType) => {
      expect(canMarkAttendance({ employeeType, fiveDayViaAttendance: false })).toBe(true);
      expect(canMarkAttendance({ employeeType, fiveDayViaAttendance: true })).toBe(true);
    }
  );
});
