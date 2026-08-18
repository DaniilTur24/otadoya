import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body: data,
    }),
  },
}));

import {
  validateXlsxFile,
  validatePdfFile,
  MAX_EXCEL_UPLOAD_BYTES,
  MAX_PDF_UPLOAD_BYTES,
} from '@/lib/upload-limits';

type MockResponse = { status: number; body: { error: string } };

function makeFile(name: string, sizeBytes: number, type: string): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

// ─── validateXlsxFile ────────────────────────────────────────────────────────

describe('validateXlsxFile', () => {
  it('returns null for a valid xlsx file', () => {
    const file = makeFile('report.xlsx', 1024, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(validateXlsxFile(file)).toBeNull();
  });

  it('returns null for octet-stream mime type', () => {
    const file = makeFile('report.xlsx', 1024, 'application/octet-stream');
    expect(validateXlsxFile(file)).toBeNull();
  });

  it('returns 400 for empty file', () => {
    const file = makeFile('report.xlsx', 0, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const res = validateXlsxFile(file) as unknown as MockResponse;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/пустой/i);
  });

  it('returns 400 for non-.xlsx extension', () => {
    const file = makeFile('report.csv', 100, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const res = validateXlsxFile(file) as unknown as MockResponse;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\.xlsx/i);
  });

  it('returns 400 for wrong mime type', () => {
    const file = makeFile('report.xlsx', 100, 'text/plain');
    const res = validateXlsxFile(file) as unknown as MockResponse;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/некорректный тип/i);
  });

  it('returns 413 when file exceeds 10 MB', () => {
    const file = makeFile('report.xlsx', MAX_EXCEL_UPLOAD_BYTES + 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const res = validateXlsxFile(file) as unknown as MockResponse;
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/большой/i);
  });

  it('returns null at exactly the size limit', () => {
    const file = makeFile('report.xlsx', MAX_EXCEL_UPLOAD_BYTES, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(validateXlsxFile(file)).toBeNull();
  });
});

// ─── validatePdfFile ─────────────────────────────────────────────────────────

describe('validatePdfFile', () => {
  it('returns null for a valid pdf file', () => {
    const file = makeFile('report.pdf', 1024, 'application/pdf');
    expect(validatePdfFile(file)).toBeNull();
  });

  it('returns null for octet-stream mime type', () => {
    const file = makeFile('report.pdf', 1024, 'application/octet-stream');
    expect(validatePdfFile(file)).toBeNull();
  });

  it('returns 400 for empty file', () => {
    const file = makeFile('report.pdf', 0, 'application/pdf');
    const res = validatePdfFile(file) as unknown as MockResponse;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/пустой/i);
  });

  it('returns 400 for non-.pdf extension', () => {
    const file = makeFile('report.docx', 100, 'application/pdf');
    const res = validatePdfFile(file) as unknown as MockResponse;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pdf/i);
  });

  it('returns 400 for wrong mime type', () => {
    const file = makeFile('report.pdf', 100, 'image/png');
    const res = validatePdfFile(file) as unknown as MockResponse;
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/некорректный тип/i);
  });

  it('returns 413 when file exceeds 15 MB', () => {
    const file = makeFile('report.pdf', MAX_PDF_UPLOAD_BYTES + 1, 'application/pdf');
    const res = validatePdfFile(file) as unknown as MockResponse;
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/большой/i);
  });

  it('returns null at exactly the size limit', () => {
    const file = makeFile('report.pdf', MAX_PDF_UPLOAD_BYTES, 'application/pdf');
    expect(validatePdfFile(file)).toBeNull();
  });
});
