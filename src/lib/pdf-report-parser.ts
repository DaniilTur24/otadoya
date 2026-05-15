// Парсер ежемесячного PDF-отчёта аптеки
// pdf-parse v1.x — CommonJS, экспортирует функцию напрямую
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export interface PdfReportResult {
  markupPercent:  number | null;
  stockRetail:    number | null;
  stockWholesale: number | null;
  allRetailValues:    number[];
  allWholesaleValues: number[];
  confident: boolean;
  // Метод по которому нашли retail — для отладки
  retailMethod: string;
}

// "33 015 629,99" → 33015629.99
function parseRuNumber(str: string): number | null {
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Все вхождения числа после паттерна
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

// ─── Стратегия поиска stockRetail ────────────────────────────────────────────
//
// pdf-parse с трёхколоночными PDF может извлечь "48 922 725,77" БЕЗ метки
// "розничным ценам" рядом — метка остаётся в левой колонке, значение конца
// месяца идёт без метки в средней. Поэтому ищем retail несколькими методами.

function findStockRetail(
  text: string,
  allRetailValues: number[],
  wholesaleIdx2: number,
  stockWholesale: number | null,
): { value: number | null; method: string } {

  // ── Метод 1: «розничным ценам [NUM]» в узком окне (150 симв) ─────────────
  // В нормальных PDF розничная и оптовая стоят рядом и оба с меткой.
  // 150 симв достаточно, чтобы поймать конец-месяца, но не захватить начало.
  if (wholesaleIdx2 >= 0) {
    const win = text.slice(Math.max(0, wholesaleIdx2 - 150), wholesaleIdx2);
    const labelPat = /розничным\s+ценам\s+([\d\s]{4,},\d{2})/gi;
    const all: RegExpExecArray[] = [];
    let lm: RegExpExecArray | null;
    while ((lm = labelPat.exec(win)) !== null) all.push(lm);
    const last = all[all.length - 1];
    if (last) {
      const v = parseRuNumber(last[1]);
      if (v && v > 0) return { value: v, method: 'method1_label_near_wholesale' };
    }
  }

  // ── Метод 3: крупное ЧИСЛО (без метки) перед 2-м «оптовым ценам» ─────────
  // Для PDF с трёхколоночной таблицей: retail появляется без метки, сразу
  // перед wholesale. retail > wholesale всегда.
  // Regex: точный формат русских чисел "48 922 725,77" — группы по 3 цифры.
  if (wholesaleIdx2 >= 0 && stockWholesale !== null) {
    const lookback = text.slice(Math.max(0, wholesaleIdx2 - 300), wholesaleIdx2);
    const RUNUM = /\d{1,3}(?: \d{3})*,\d{2}/g;
    const nums: number[] = [];
    let rm: RegExpExecArray | null;
    while ((rm = RUNUM.exec(lookback)) !== null) {
      const n = parseRuNumber(rm[0]);
      if (n !== null && n > stockWholesale) nums.push(n);
    }
    if (nums.length > 0) {
      return { value: nums[nums.length - 1], method: 'method3_bare_number_before_wholesale' };
    }
  }

  // ── Метод 2: второе «розничным ценам» ────────────────────────────────────
  // Применяем ПОСЛЕ M3: в трёхколоночном PDF второе вхождение может быть
  // «по розничным ценам ... поступило», а не конец-месяца.
  if (allRetailValues.length >= 2) {
    return { value: allRetailValues[1], method: 'method2_second_labeled_occurrence' };
  }

  // ── Метод 4: первое вхождение (крайний запасной) ─────────────────────────
  if (allRetailValues.length >= 1) {
    return { value: allRetailValues[0], method: 'method4_first_fallback' };
  }

  return { value: null, method: 'not_found' };
}

export async function parsePdfReport(buffer: Buffer): Promise<PdfReportResult> {
  const data = await pdfParse(buffer);
  const raw: string = data.text;

  // Нормализуем: переносы → пробелы, множественные пробелы → один
  const text = raw.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ');

  // ── Все вхождения розничных цен ─────────────────────────────────────────
  const RETAIL_RE = /розничным ценам\s+([\d\s]{1,20},\d{2})/gi;
  const allRetailValues = findAllAfter(text, RETAIL_RE);

  // ── Все вхождения оптовых цен ────────────────────────────────────────────
  const WHOLESALE_RE = /оптовым ценам\s+([\d\s]{1,20},\d{2})/gi;
  const allWholesaleValues = findAllAfter(text, WHOLESALE_RE);

  // ── Наценка от выручки ───────────────────────────────────────────────────
  const MARKUP_RE = /наценка от выручки\s+([\d,\.]+)/i;
  const markupMatch = text.match(MARKUP_RE);
  const markupPercent = markupMatch ? parseRuNumber(markupMatch[1]) : null;

  // ── Wholesale: берём второе вхождение (конец месяца) ────────────────────
  const stockWholesale = allWholesaleValues.length >= 2
    ? allWholesaleValues[1]
    : (allWholesaleValues[0] ?? null);

  // Находим позицию 2-го вхождения "оптовым ценам" в тексте для метода 1/3
  let wholesaleIdx2 = -1;
  {
    let count = 0;
    const wpat = /оптовым ценам\s+([\d\s]{1,20},\d{2})/gi;
    let wm: RegExpExecArray | null;
    while ((wm = wpat.exec(text)) !== null) {
      const n = parseRuNumber(wm[1]);
      if (!n || n <= 0) continue;
      if (++count === 2) { wholesaleIdx2 = wm.index; break; }
    }
  }

  // ── Retail: многоуровневый поиск ─────────────────────────────────────────
  const { value: stockRetail, method: retailMethod } = findStockRetail(
    text, allRetailValues, wholesaleIdx2, stockWholesale
  );

  // Уверенность: нашли 2+ значения для каждого и наценку, и retail ≠ fallback
  const confident =
    markupPercent !== null &&
    stockRetail !== null &&
    stockWholesale !== null &&
    !retailMethod.includes('fallback') &&
    !retailMethod.includes('not_found');

  return {
    markupPercent,
    stockRetail,
    stockWholesale,
    allRetailValues,
    allWholesaleValues,
    confident,
    retailMethod,
  };
}
