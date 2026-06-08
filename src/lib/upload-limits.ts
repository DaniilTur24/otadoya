import { NextResponse } from 'next/server';

export const MAX_EXCEL_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_EXCEL_ROWS = 5000;

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  '',
]);

const PDF_MIME_TYPES = new Set(['application/pdf', 'application/octet-stream', '']);

export function validateXlsxFile(file: File): NextResponse | null {
  if (file.size === 0) {
    return NextResponse.json({ error: 'Файл пустой' }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Принимаются только .xlsx файлы' }, { status: 400 });
  }

  if (!XLSX_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Некорректный тип Excel-файла' }, { status: 400 });
  }

  if (file.size > MAX_EXCEL_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Файл слишком большой. Максимум 10 МБ' }, { status: 413 });
  }

  return null;
}

export function validatePdfFile(file: File): NextResponse | null {
  if (file.size === 0) {
    return NextResponse.json({ error: 'Файл пустой' }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Принимается только PDF-файл' }, { status: 400 });
  }

  if (!PDF_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Некорректный тип PDF-файла' }, { status: 400 });
  }

  if (file.size > MAX_PDF_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'PDF слишком большой. Максимум 15 МБ' }, { status: 413 });
  }

  return null;
}
