import { describe, it, expect, vi, beforeEach } from 'vitest';
import { excelSerialDateToDate, readFirstWorksheetRows } from '@/lib/xlsx-reader';

vi.mock('read-excel-file/node', () => ({
  readSheet: vi.fn(),
}));

import { readSheet } from 'read-excel-file/node';

// ─── excelSerialDateToDate ───────────────────────────────────────────────────

describe('excelSerialDateToDate', () => {
  function dateToSerial(year: number, month: number, day: number): number {
    const utcMs = Date.UTC(year, month - 1, day);
    return Math.round(utcMs / 86400000 + 25569);
  }

  it('returns null for 0', () => {
    expect(excelSerialDateToDate(0)).toBeNull();
  });

  it('returns null for negative value', () => {
    expect(excelSerialDateToDate(-5)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(excelSerialDateToDate(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(excelSerialDateToDate(Infinity)).toBeNull();
  });

  it('converts 2023-01-01 serial correctly', () => {
    const serial = dateToSerial(2023, 1, 1);
    const result = excelSerialDateToDate(serial);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2023);
    expect(result!.getMonth()).toBe(0);
    expect(result!.getDate()).toBe(1);
  });

  it('converts 2024-06-15 serial correctly', () => {
    const serial = dateToSerial(2024, 6, 15);
    const result = excelSerialDateToDate(serial);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(5);
    expect(result!.getDate()).toBe(15);
  });

  it('converts 2025-12-31 serial correctly', () => {
    const serial = dateToSerial(2025, 12, 31);
    const result = excelSerialDateToDate(serial);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2025);
    expect(result!.getMonth()).toBe(11);
    expect(result!.getDate()).toBe(31);
  });

  it('returns a Date instance (not UTC-shifted)', () => {
    const serial = dateToSerial(2024, 3, 20);
    const result = excelSerialDateToDate(serial);
    expect(result).toBeInstanceOf(Date);
    // The function explicitly constructs with local year/month/date from UTC components
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(2);
    expect(result!.getDate()).toBe(20);
  });
});

// ─── readFirstWorksheetRows ──────────────────────────────────────────────────

describe('readFirstWorksheetRows', () => {
  beforeEach(() => {
    vi.mocked(readSheet).mockReset();
  });

  it('returns rows from readSheet, replacing nulls with empty strings', async () => {
    vi.mocked(readSheet).mockResolvedValue([
      ['A', null as unknown as string, 'C'],
      [1, 2, null as unknown as string],
    ] as unknown as ReturnType<typeof readSheet> extends Promise<infer R> ? R : never);

    const rows = await readFirstWorksheetRows(Buffer.from(''));
    expect(rows[0]).toEqual(['A', '', 'C']);
    expect(rows[1]).toEqual([1, 2, '']);
  });

  it('throws when row count exceeds MAX_EXCEL_ROWS (5000)', async () => {
    const bigSheet = Array.from({ length: 5001 }, () => ['cell']);
    vi.mocked(readSheet).mockResolvedValue(bigSheet as unknown as ReturnType<typeof readSheet> extends Promise<infer R> ? R : never);

    await expect(readFirstWorksheetRows(Buffer.from(''))).rejects.toThrow(
      'Слишком много строк'
    );
  });

  it('does not throw when row count equals MAX_EXCEL_ROWS exactly', async () => {
    const exactSheet = Array.from({ length: 5000 }, () => ['cell']);
    vi.mocked(readSheet).mockResolvedValue(exactSheet as unknown as ReturnType<typeof readSheet> extends Promise<infer R> ? R : never);

    const rows = await readFirstWorksheetRows(Buffer.from(''));
    expect(rows).toHaveLength(5000);
  });

  it('returns empty array for empty sheet', async () => {
    vi.mocked(readSheet).mockResolvedValue([] as unknown as ReturnType<typeof readSheet> extends Promise<infer R> ? R : never);
    const rows = await readFirstWorksheetRows(Buffer.from(''));
    expect(rows).toEqual([]);
  });
});
