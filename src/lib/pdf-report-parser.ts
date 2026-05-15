// Парсер ежемесячного PDF-отчёта аптеки
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

export interface PdfReportResult {
  markupPercent:  number | null;  // Наценка от выручки (%)
  stockRetail:    number | null;  // Остаток на конец месяца по розн ценам
  stockWholesale: number | null;  // Остаток на конец месяца по опт ценам
  // Все найденные значения — для отображения при проверке
  allRetailValues:    number[];
  allWholesaleValues: number[];
  confident: boolean;             // Система уверена в значениях
}

// Преобразует "33 015 629,99" → 33015629.99
function parseRuNumber(str: string): number | null {
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Находит все числа после паттерна в тексте
function findAllAfter(text: string, pattern: RegExp): number[] {
  const results: number[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((match = re.exec(text)) !== null) {
    const n = parseRuNumber(match[1]);
    if (n !== null && n > 0) results.push(n);
  }
  return results;
}

export async function parsePdfReport(buffer: Buffer): Promise<PdfReportResult> {
  const data = await pdfParse(buffer);
  const raw: string = data.text;

  // Нормализуем: убираем переносы строк, схлопываем пробелы
  const text = raw.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ');

  // ── Розничные цены ──────────────────────────────────────────────────────
  // Шаблон: "розничным ценам <число>"
  // Числа могут быть: "32 807 093,12" / "33 015 629,99" / "208 536,87"
  const RETAIL_RE = /розничным ценам\s+([\d\s]{1,20},\d{2})/gi;
  const allRetailValues = findAllAfter(text, RETAIL_RE);

  // ── Оптовые цены ────────────────────────────────────────────────────────
  const WHOLESALE_RE = /оптовым ценам\s+([\d\s]{1,20},\d{2})/gi;
  const allWholesaleValues = findAllAfter(text, WHOLESALE_RE);

  // ── Наценка от выручки ──────────────────────────────────────────────────
  const MARKUP_RE = /наценка от выручки\s+([\d,\.]+)/i;
  const markupMatch = text.match(MARKUP_RE);
  const markupPercent = markupMatch ? parseRuNumber(markupMatch[1]) : null;

  // ── Берём второе вхождение (конец месяца) ───────────────────────────────
  // Порядок в PDF: начало месяца → конец месяца → изменение
  const stockRetail    = allRetailValues.length    >= 2 ? allRetailValues[1]    : (allRetailValues[0] ?? null);
  const stockWholesale = allWholesaleValues.length >= 2 ? allWholesaleValues[1] : (allWholesaleValues[0] ?? null);

  // Уверенность: нашли хотя бы 2 значения для каждого поля и наценку
  const confident =
    markupPercent !== null &&
    allRetailValues.length >= 2 &&
    allWholesaleValues.length >= 2;

  return {
    markupPercent,
    stockRetail,
    stockWholesale,
    allRetailValues,
    allWholesaleValues,
    confident,
  };
}
