import { readSheet } from 'read-excel-file/node';
import { MAX_EXCEL_ROWS } from '@/lib/upload-limits';

export async function readFirstWorksheetRows(buffer: Buffer): Promise<unknown[][]> {
  const rows = await readSheet(buffer);
  if (rows.length > MAX_EXCEL_ROWS) {
    throw new Error(`Слишком много строк в Excel-файле. Максимум ${MAX_EXCEL_ROWS}`);
  }

  return rows.map((row) => row.map((cell) => cell ?? ''));
}

export function excelSerialDateToDate(value: number): Date | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  const date = new Date(Math.round((value - 25569) * 86400 * 1000));
  if (Number.isNaN(date.getTime())) return null;

  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
