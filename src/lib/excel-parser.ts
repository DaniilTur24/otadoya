import { excelSerialDateToDate, readFirstWorksheetRows } from '@/lib/xlsx-reader';

// Ключевые слова для определения категории
const RENT_KEYWORDS = ['аренда', 'аренду', 'арендная плата', 'арендная'];
const EXPENSE_KEYWORDS = ['расход', 'расходы'];

// Варианты заголовков колонок в банковских выгрузках
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['дата операции', 'дата проведения', 'дата платежа', 'дата транзакции', 'дата документа', 'дата', 'date'],
  // Дебет — исходящие платежи (расходы), Кредит — входящие
  debit: ['дебет', 'debit', 'расход', 'сумма (дебет)', 'списание'],
  credit: ['кредит', 'credit', 'приход', 'сумма (кредит)', 'зачисление'],
  amount: ['сумма', 'amount', 'сумма операции', 'сумма платежа'],
  counterparty: [
    'наименование бенефициара', 'контрагент', 'получатель', 'плательщик',
    'наименование контрагента', 'плательщик/получатель', 'наименование',
    'бенефициар',
  ],
  description: [
    'назначение платежа', 'назначение', 'описание', 'наименование операции',
    'примечание', 'note', 'description', 'details',
  ],
};

function normalizeText(text: string): string {
  return text.toString().toLowerCase().trim();
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => (h ? normalizeText(h) : ''));
  for (const alias of aliases) {
    const idx = normalized.findIndex((h) => h && (h.includes(alias) || alias.includes(h)));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function detectCategory(text: string): 'rent' | 'expense' | null {
  const lower = normalizeText(text);
  for (const kw of RENT_KEYWORDS) {
    if (lower.includes(kw)) return 'rent';
  }
  for (const kw of EXPENSE_KEYWORDS) {
    if (lower.includes(kw)) return 'expense';
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    return excelSerialDateToDate(value);
  }
  if (typeof value === 'string' && value.trim()) {
    // Формат DD.MM.YYYY [HH:MM:SS] — Kaspi и другие банки
    const parts = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (parts) return new Date(`${parts[3]}-${parts[2]}-${parts[1]}`);
    const d = new Date(value.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseAmount(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0';
  let str = String(value).trim();
  // Убираем пробелы-разделители тысяч (русский формат: 1 000 000)
  str = str.replace(/\s/g, '');
  if (str.includes(',') && str.includes('.')) {
    // Формат "1,234,567.89" — запятая тысяч, точка дробная
    str = str.replace(/,/g, '');
  } else if (str.includes(',')) {
    const parts = str.split(',');
    const lastPart = parts[parts.length - 1].replace(/[^\d]/g, '');
    if (lastPart.length === 2) {
      // Формат "1234,56" — запятая дробная (европейский)
      str = str.replace(',', '.');
    } else {
      // Формат "1,234,567" — запятая тысяч
      str = str.replace(/,/g, '');
    }
  }
  const num = parseFloat(str.replace(/[^\d.-]/g, ''));
  if (isNaN(num)) return '0';
  return Math.abs(num).toFixed(2);
}

// ─── Общая функция разбора структуры файла ───────────────────────────────────

interface ParsedColumns {
  rows: unknown[][];
  headerRowIdx: number;
  dateCol: number;
  debitCol: number;
  creditCol: number;
  amountCol: number;
  counterpartyCol: number;
  descriptionCol: number;
}

async function parseStructure(buffer: Buffer): Promise<ParsedColumns | null> {
  const rows = await readFirstWorksheetRows(buffer);
  if (rows.length < 2) return null;

  // Ищем строку заголовков: максимальное число ячеек, совпадающих с известными именами
  const HEADER_KEYWORDS = [
    'дата', 'date', 'сумма', 'amount', 'дебет', 'debit', 'кредит', 'credit',
    'назначение', 'описание', 'description', 'контрагент', 'получатель',
    'наименование', 'расход', 'приход',
  ];

  let headerRowIdx = -1;
  let bestScore = 1;

  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i];
    if (!row || row.filter(Boolean).length < 3) continue;
    let score = 0;
    for (const cell of row) {
      if (!cell) continue;
      const norm = normalizeText(String(cell));
      if (HEADER_KEYWORDS.some((kw) => norm.includes(kw))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = i;
    }
  }

  if (headerRowIdx === -1) return null;

  const headers = (rows[headerRowIdx] || []).map((h) => (h ? String(h) : ''));

  return {
    rows,
    headerRowIdx,
    dateCol: findColumnIndex(headers, COLUMN_ALIASES.date),
    debitCol: findColumnIndex(headers, COLUMN_ALIASES.debit),
    creditCol: findColumnIndex(headers, COLUMN_ALIASES.credit),
    amountCol: findColumnIndex(headers, COLUMN_ALIASES.amount),
    counterpartyCol: findColumnIndex(headers, COLUMN_ALIASES.counterparty),
    descriptionCol: findColumnIndex(headers, COLUMN_ALIASES.description),
  };
}

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface ParsedExpense {
  rowIndex: number;
  operationDate: Date;
  amount: string;
  counterparty: string | null;
  description: string;
  category: 'rent' | 'expense';
}

export interface FileRow {
  rowIndex: number;
  operationDate: Date | null;
  amount: string;
  counterparty: string | null;
  description: string;
  // Категория, если системой обнаружена автоматически
  autoCategory: 'rent' | 'expense' | null;
}

// ─── Экспортируемые функции ───────────────────────────────────────────────────

/** Возвращает только строки с ключевыми словами (аренда/расход) */
export async function parseExcelFile(buffer: Buffer): Promise<ParsedExpense[]> {
  const parsed = await parseStructure(buffer);
  if (!parsed) return [];

  const { rows, headerRowIdx, dateCol, debitCol, creditCol, amountCol, counterpartyCol, descriptionCol } = parsed;
  const results: ParsedExpense[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.filter(Boolean).length === 0) continue;

    let description = '';
    if (descriptionCol !== -1 && row[descriptionCol]) {
      description = String(row[descriptionCol]);
    } else {
      description = row
        .filter((cell) => cell && typeof cell === 'string' && cell.length > 5)
        .join(' ');
    }
    if (!description) continue;

    const category = detectCategory(description);
    if (!category) continue;

    // Если есть колонки дебет и кредит — берём только строки с суммой в дебете.
    // Дебет = исходящий платёж (расход), кредит = входящий/возврат — не расход.
    const rowDebit = debitCol !== -1 ? row[debitCol] : undefined;
    const rowCredit = creditCol !== -1 ? row[creditCol] : undefined;
    if (debitCol !== -1 && creditCol !== -1 && !rowDebit && rowCredit) continue;

    const operationDate = dateCol !== -1 ? (parseDate(row[dateCol]) ?? new Date()) : new Date();

    let rawAmount: unknown = undefined;
    if (debitCol !== -1 && row[debitCol]) rawAmount = row[debitCol];
    else if (amountCol !== -1 && row[amountCol]) rawAmount = row[amountCol];
    else if (creditCol !== -1 && row[creditCol]) rawAmount = row[creditCol];

    const counterparty =
      counterpartyCol !== -1 && row[counterpartyCol]
        ? String(row[counterpartyCol]).trim() || null
        : null;

    results.push({
      rowIndex: i,
      operationDate,
      amount: parseAmount(rawAmount),
      counterparty,
      description,
      category,
    });
  }

  return results;
}

/** Возвращает ВСЕ строки файла (для ручного просмотра бухгалтером) */
export async function parseAllFileRows(buffer: Buffer): Promise<FileRow[]> {
  const parsed = await parseStructure(buffer);
  if (!parsed) return [];

  const { rows, headerRowIdx, dateCol, debitCol, creditCol, amountCol, counterpartyCol, descriptionCol } = parsed;
  const results: FileRow[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.filter(Boolean).length === 0) continue;

    // Пропускаем строки, где нет ни даты, ни суммы (итоговые/пустые строки)
    const hasDate = dateCol !== -1 && row[dateCol];
    const hasAmount =
      (debitCol !== -1 && row[debitCol]) ||
      (creditCol !== -1 && row[creditCol]) ||
      (amountCol !== -1 && row[amountCol]);
    if (!hasDate && !hasAmount) continue;

    let description = '';
    if (descriptionCol !== -1 && row[descriptionCol]) {
      description = String(row[descriptionCol]);
    } else {
      description = row
        .filter((cell) => cell && typeof cell === 'string' && cell.length > 5)
        .join(' ');
    }

    const operationDate = dateCol !== -1 ? parseDate(row[dateCol]) : null;

    let rawAmount: unknown = undefined;
    if (debitCol !== -1 && row[debitCol]) rawAmount = row[debitCol];
    else if (amountCol !== -1 && row[amountCol]) rawAmount = row[amountCol];
    else if (creditCol !== -1 && row[creditCol]) rawAmount = row[creditCol];

    const counterparty =
      counterpartyCol !== -1 && row[counterpartyCol]
        ? String(row[counterpartyCol]).split('\n')[0].trim() || null
        : null;

    results.push({
      rowIndex: i,
      operationDate,
      amount: parseAmount(rawAmount),
      counterparty,
      description,
      autoCategory: description ? detectCategory(description) : null,
    });
  }

  return results;
}
