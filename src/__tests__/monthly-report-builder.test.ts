import { describe, it, expect, vi } from 'vitest';
import { buildMonthlySnapshot } from '@/lib/monthly-report-builder';
import { MONTHLY_REPORT_ROWS } from '@/lib/monthly-report-fields';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

// ─── helpers ─────────────────────────────────────────────────────────────────

type SystemData = Record<number, Record<string, number>>;
type OverrideMap = Record<string, number>;

/** Builds the zero-filled systemData row expected by the builder. */
function emptyRow(): Record<string, number> {
  return {
    retailRevenue: 0, kaspiRevenue: 0, wholesaleRevenue: 0, coefficient: 0,
    avgDailyRevenue: 0, terminalRent: 0, procedureRent: 0, legalEntityProfit: 0,
    stockRetail: 0, stockWholesale: 0, consignment: 0, consignmentOverdue: 0,
    goodsExpenses: 0, pharmaBonus: 0, employeeAdvance: 0, pharmaSalary: 0, officeSalary: 0,
    association: 0, charity: 0, accountingServices: 0, stationery: 0,
    utilities: 0, deferredTax: 0, vat: 0, security: 0,
    otherExpenses: 0, householdExpenses: 0, advertising: 0, repairs: 0,
    rentExpenses: 0, standardKaspibot: 0, daribar: 0,
    communications: 0, equipment: 0, transport: 0, cleaning: 0, bankServices: 0,
    totalExpenses: 0, netIncome: 0, divideBy2: 0, directorShare: 0,
  };
}

// ─── buildMonthlySnapshot ────────────────────────────────────────────────────

describe('buildMonthlySnapshot', () => {
  it('returns an empty object for empty pharmacies list', () => {
    expect(buildMonthlySnapshot([], {}, {})).toEqual({});
  });

  it('creates a key per pharmacy using string id', () => {
    const data: SystemData = { 1: emptyRow(), 5: emptyRow() };
    const snapshot = buildMonthlySnapshot([{ id: 1 }, { id: 5 }], data, {});
    expect(Object.keys(snapshot)).toEqual(['1', '5']);
  });

  it('includes only non-section rows', () => {
    const data: SystemData = { 1: emptyRow() };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], data, {});
    const sectionKeys = MONTHLY_REPORT_ROWS.filter((r) => r.section).map((r) => r.key);
    for (const k of sectionKeys) {
      expect(snapshot['1']).not.toHaveProperty(k);
    }
  });

  it('passes through a plain field from systemData', () => {
    const row = { ...emptyRow(), retailRevenue: 150000 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, {});
    expect(snapshot['1'].retailRevenue).toBe(150000);
  });

  it('override takes precedence over systemData', () => {
    const row = { ...emptyRow(), retailRevenue: 100000 };
    const overrides: OverrideMap = { '1:retailRevenue': 999 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, overrides);
    expect(snapshot['1'].retailRevenue).toBe(999);
  });

  it('computes wholesaleRevenue as retailRevenue / coefficient', () => {
    const row = { ...emptyRow(), retailRevenue: 200000, coefficient: 2 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, {});
    expect(snapshot['1'].wholesaleRevenue).toBe(100000);
  });

  it('wholesaleRevenue is 0 when coefficient is 0', () => {
    const row = { ...emptyRow(), retailRevenue: 200000, coefficient: 0 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, {});
    expect(snapshot['1'].wholesaleRevenue).toBe(0);
  });

  it('override on coefficient affects wholesaleRevenue computation', () => {
    const row = { ...emptyRow(), retailRevenue: 100000, coefficient: 1 };
    const overrides: OverrideMap = { '1:coefficient': 4 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, overrides);
    // wholesaleRevenue = retailRevenue / overridden coefficient = 100000 / 4
    expect(snapshot['1'].wholesaleRevenue).toBe(25000);
  });

  it('computes totalExpenses as sum of all expense rows', () => {
    const row = { ...emptyRow(), goodsExpenses: 10000, pharmaSalary: 5000, rentExpenses: 3000 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, {});
    expect(snapshot['1'].totalExpenses).toBe(18000);
  });

  it('computes netIncome as total income minus total expenses', () => {
    const row = {
      ...emptyRow(),
      retailRevenue: 100000,
      goodsExpenses: 20000,
      pharmaSalary: 10000,
    };
    const snapshot = buildMonthlySnapshot([{ id: 1 }], { 1: row }, {});
    // income rows: retailRevenue=100000, others=0
    // expense rows: goodsExpenses=20000, pharmaSalary=10000, others=0
    expect(snapshot['1'].netIncome).toBe(70000);
  });

  it('defaults to 0 for a pharmacy with no systemData entry', () => {
    const snapshot = buildMonthlySnapshot([{ id: 99 }], {}, {});
    expect(snapshot['99'].retailRevenue).toBe(0);
    expect(snapshot['99'].goodsExpenses).toBe(0);
  });

  it('handles multiple pharmacies independently', () => {
    const data: SystemData = {
      1: { ...emptyRow(), retailRevenue: 100000 },
      2: { ...emptyRow(), retailRevenue: 200000 },
    };
    const snapshot = buildMonthlySnapshot([{ id: 1 }, { id: 2 }], data, {});
    expect(snapshot['1'].retailRevenue).toBe(100000);
    expect(snapshot['2'].retailRevenue).toBe(200000);
  });

  it('override for one pharmacy does not affect another', () => {
    const data: SystemData = {
      1: { ...emptyRow(), retailRevenue: 100000 },
      2: { ...emptyRow(), retailRevenue: 100000 },
    };
    const overrides: OverrideMap = { '1:retailRevenue': 500 };
    const snapshot = buildMonthlySnapshot([{ id: 1 }, { id: 2 }], data, overrides);
    expect(snapshot['1'].retailRevenue).toBe(500);
    expect(snapshot['2'].retailRevenue).toBe(100000);
  });
});
