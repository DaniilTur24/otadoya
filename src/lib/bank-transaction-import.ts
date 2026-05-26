import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';

type ImportTx = Prisma.TransactionClient;

export type DistributionType =
  | 'specific_pharmacy'
  | 'detect_pharmacy_from_text'
  | 'split_equally'
  | 'split_custom';

export interface CustomDistributionItem {
  pharmacyId: number;
  amount: string;
}

export interface ParsedBankTransaction {
  rowIndex: number;
  transactionDate: Date | null;
  amount: string;
  counterparty: string | null;
  binIin: string | null;
  paymentPurpose: string | null;
  rawRowJson: string;
  searchableText: string;
  sourceValues: {
    purpose: string;
    counterparty: string;
    bin_iin: string;
    any_text: string;
  };
}

interface ColumnMap {
  rows: unknown[][];
  headers: string[];
  headerRowIdx: number;
  dateCol: number;
  debitCol: number;
  creditCol: number;
  amountCol: number;
  counterpartyCol: number;
  binIinCol: number;
  purposeCol: number;
}

interface RuleLike {
  id: number;
  sourceField: string;
  pattern: string;
  matchType: string;
  targetFieldKey: string | null;
  distributionType: string;
  pharmacyId: number | null;
  priority: number;
}

interface PharmacyLike {
  id: number;
  name: string;
}

interface AliasLike {
  pharmacyId: number;
  alias: string;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  date: [
    'дата операции',
    'дата проведения',
    'дата платежа',
    'дата транзакции',
    'дата документа',
    'дата',
    'date',
  ],
  debit: ['дебет', 'debit', 'расход', 'сумма (дебет)', 'списание'],
  credit: ['кредит', 'credit', 'приход', 'сумма (кредит)', 'зачисление'],
  amount: ['сумма', 'amount', 'сумма операции', 'сумма платежа'],
  counterparty: [
    'наименование бенефициара',
    'контрагент',
    'получатель',
    'плательщик',
    'наименование контрагента',
    'плательщик/получатель',
    'наименование',
    'бенефициар',
    'отправитель',
    'ип',
  ],
  binIin: [
    'иин/бин',
    'бин/иин',
    'иин',
    'бин',
    'iin',
    'bin',
    'идентификатор',
    'кбе',
  ],
  purpose: [
    'назначение платежа',
    'назначение',
    'описание',
    'наименование операции',
    'примечание',
    'note',
    'description',
    'details',
  ],
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => normalizeText(h));
  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);
    const idx = normalized.findIndex((h) => h && (h.includes(normalizedAlias) || normalizedAlias.includes(h)));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }

  const text = visibleText(value);
  if (!text) return null;

  const ru = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));

  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const date = new Date(text);
  return isNaN(date.getTime()) ? null : date;
}

function parseAmount(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0.00';

  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return '0.00';

  if (text.includes(',') && text.includes('.')) {
    text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    const parts = text.split(',');
    const last = parts[parts.length - 1].replace(/[^\d]/g, '');
    text = last.length <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
  }

  const amount = Math.abs(Number.parseFloat(text.replace(/[^\d.-]/g, '')));
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function parseStructure(buffer: Buffer): ColumnMap | null {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    dateNF: 'YYYY-MM-DD',
  }) as unknown[][];

  if (rows.length < 2) return null;

  const headerKeywords = [
    'дата',
    'date',
    'сумма',
    'amount',
    'дебет',
    'debit',
    'кредит',
    'credit',
    'назначение',
    'описание',
    'description',
    'контрагент',
    'получатель',
    'плательщик',
    'бенефициар',
    'иин',
    'бин',
  ];

  let headerRowIdx = -1;
  let bestScore = 1;

  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i] ?? [];
    if (row.filter(Boolean).length < 3) continue;

    let score = 0;
    for (const cell of row) {
      const norm = normalizeText(cell);
      if (headerKeywords.some((kw) => norm.includes(kw))) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = i;
    }
  }

  if (headerRowIdx === -1) return null;

  const headers = (rows[headerRowIdx] ?? []).map((h, index) => visibleText(h) || `column_${index + 1}`);

  return {
    rows,
    headers,
    headerRowIdx,
    dateCol: findColumnIndex(headers, COLUMN_ALIASES.date),
    debitCol: findColumnIndex(headers, COLUMN_ALIASES.debit),
    creditCol: findColumnIndex(headers, COLUMN_ALIASES.credit),
    amountCol: findColumnIndex(headers, COLUMN_ALIASES.amount),
    counterpartyCol: findColumnIndex(headers, COLUMN_ALIASES.counterparty),
    binIinCol: findColumnIndex(headers, COLUMN_ALIASES.binIin),
    purposeCol: findColumnIndex(headers, COLUMN_ALIASES.purpose),
  };
}

function rowToJson(headers: string[], row: unknown[]): string {
  const result: Record<string, string> = {};
  for (let i = 0; i < row.length; i++) {
    const value = visibleText(row[i]);
    if (!value) continue;
    result[headers[i] || `column_${i + 1}`] = value;
  }
  return JSON.stringify(result);
}

function collectSearchableText(row: unknown[]): string {
  return row.map(visibleText).filter(Boolean).join(' ');
}

export function parseBankTransactionsExcel(buffer: Buffer): ParsedBankTransaction[] {
  const structure = parseStructure(buffer);
  if (!structure) return [];

  const {
    rows,
    headers,
    headerRowIdx,
    dateCol,
    debitCol,
    creditCol,
    amountCol,
    counterpartyCol,
    binIinCol,
    purposeCol,
  } = structure;

  const result: ParsedBankTransaction[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.filter(Boolean).length === 0) continue;

    const rawAmount =
      debitCol !== -1 && row[debitCol]
        ? row[debitCol]
        : creditCol !== -1 && row[creditCol]
        ? row[creditCol]
        : amountCol !== -1
        ? row[amountCol]
        : undefined;

    const amount = parseAmount(rawAmount);
    const transactionDate = dateCol !== -1 ? parseDate(row[dateCol]) : null;
    const counterparty = counterpartyCol !== -1 ? visibleText(row[counterpartyCol]) || null : null;
    const binIin = binIinCol !== -1 ? visibleText(row[binIinCol]) || null : null;
    const paymentPurpose = purposeCol !== -1 ? visibleText(row[purposeCol]) || null : null;
    const fallbackText = collectSearchableText(row);
    const searchableText = [paymentPurpose, counterparty, binIin, fallbackText].filter(Boolean).join(' ');

    if (!transactionDate && amount === '0.00' && !searchableText.trim()) continue;

    result.push({
      rowIndex: i,
      transactionDate,
      amount,
      counterparty,
      binIin,
      paymentPurpose,
      rawRowJson: rowToJson(headers, row),
      searchableText,
      sourceValues: {
        purpose: paymentPurpose ?? '',
        counterparty: counterparty ?? '',
        bin_iin: binIin ?? '',
        any_text: searchableText,
      },
    });
  }

  return result;
}

export function matchTransactionRule(transaction: ParsedBankTransaction, rules: RuleLike[]): RuleLike | null {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority || a.id - b.id);

  for (const rule of sorted) {
    const field = rule.sourceField === 'any_text' ? 'any_text' : rule.sourceField;
    const source = normalizeText(transaction.sourceValues[field as keyof ParsedBankTransaction['sourceValues']] ?? '');
    const pattern = normalizeText(rule.pattern);

    if (!pattern) continue;

    if (rule.matchType === 'exact' && source === pattern) return rule;
    if (rule.matchType === 'contains' && source.includes(pattern)) return rule;
    if (rule.matchType === 'regex') {
      try {
        if (new RegExp(rule.pattern, 'i').test(transaction.sourceValues[field as keyof ParsedBankTransaction['sourceValues']] ?? '')) {
          return rule;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function detectPharmacyFromAliases(searchableText: string, aliases: AliasLike[]): {
  pharmacyId: number | null;
  ambiguous: boolean;
} {
  const haystack = normalizeText(searchableText);
  const pharmacyIds = new Set<number>();

  for (const alias of aliases) {
    const needle = normalizeText(alias.alias);
    if (needle && haystack.includes(needle)) pharmacyIds.add(alias.pharmacyId);
  }

  if (pharmacyIds.size === 1) {
    return { pharmacyId: Array.from(pharmacyIds)[0], ambiguous: false };
  }

  return { pharmacyId: null, ambiguous: pharmacyIds.size > 1 };
}

export function splitAmountEqually(amount: string | number, parts: number): string[] {
  if (parts <= 0) return [];

  const totalCents = Math.round(Number(amount) * 100);
  const base = Math.trunc(totalCents / parts);
  const remainder = totalCents - base * parts;

  return Array.from({ length: parts }, (_, index) => {
    const cents = base + (index < remainder ? 1 : 0);
    return (cents / 100).toFixed(2);
  });
}

async function createReportValues(
  tx: ImportTx,
  params: {
    importedTransactionId: number;
    uploadId: number;
    amount: string | number | Prisma.Decimal;
    fieldKey: string | null;
    distributionType: string | null;
    pharmacyId: number | null;
    activePharmacies: PharmacyLike[];
    customDistribution?: CustomDistributionItem[] | null;
  }
): Promise<{ status: string; detectedPharmacyId: number | null }> {
  const { importedTransactionId, uploadId, amount, fieldKey, distributionType, pharmacyId, activePharmacies, customDistribution } = params;

  if (!fieldKey || !distributionType) {
    return { status: 'needs_review', detectedPharmacyId: pharmacyId };
  }

  if (distributionType === 'specific_pharmacy' || distributionType === 'detect_pharmacy_from_text') {
    if (!pharmacyId) return { status: 'needs_review', detectedPharmacyId: null };

    await tx.importedReportValue.create({
      data: {
        importedTransactionId,
        uploadId,
        pharmacyId,
        fieldKey,
        amount: String(amount),
        status: 'pending',
        distributionType,
      },
    });
    return { status: 'pending', detectedPharmacyId: pharmacyId };
  }

  if (distributionType === 'split_equally') {
    if (activePharmacies.length === 0) return { status: 'needs_review', detectedPharmacyId: null };

    const shares = splitAmountEqually(Number(amount), activePharmacies.length);
    await tx.importedReportValue.createMany({
      data: activePharmacies.map((pharmacy, index) => ({
        importedTransactionId,
        uploadId,
        pharmacyId: pharmacy.id,
        fieldKey,
        amount: shares[index],
        status: 'pending',
        distributionType,
      })),
    });
    return { status: 'pending', detectedPharmacyId: null };
  }

  if (distributionType === 'split_custom') {
    if (!customDistribution || customDistribution.length === 0) {
      return { status: 'needs_review', detectedPharmacyId: null };
    }
    await tx.importedReportValue.createMany({
      data: customDistribution.map((item) => ({
        importedTransactionId,
        uploadId,
        pharmacyId: item.pharmacyId,
        fieldKey,
        amount: item.amount,
        status: 'pending',
        distributionType,
      })),
    });
    return { status: 'pending', detectedPharmacyId: null };
  }

  return { status: 'needs_review', detectedPharmacyId: pharmacyId };
}

export async function importParsedBankTransactions(
  tx: ImportTx,
  uploadId: number,
  transactions: ParsedBankTransaction[]
) {
  const [rules, aliases, activePharmacies] = await Promise.all([
    tx.transactionImportRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    }),
    tx.pharmacyAlias.findMany({
      where: { isActive: true, pharmacy: { isActive: true } },
      select: { pharmacyId: true, alias: true },
    }),
    tx.pharmacy.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  type TxInput = {
    uploadId: number;
    transactionDate: Date | null;
    amount: string;
    counterparty: string | null;
    binIin: string | null;
    paymentPurpose: string | null;
    rawRowJson: string;
    searchableText: string;
    matchedRuleId: number | null;
    detectedPharmacyId: number | null;
    targetFieldKey: string | null;
    distributionType: string | null;
    status: string;
  };

  type RvSpec = {
    txIndex: number;
    pharmacyId: number | null;
    fieldKey: string;
    amount: string;
    distributionType: string;
  };

  const txInputs: TxInput[] = [];
  const rvSpecs: RvSpec[] = [];
  let needsReviewCount = 0;

  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    const rule = matchTransactionRule(transaction, rules);

    let distributionType = rule?.distributionType ?? null;
    let fieldKey = rule?.targetFieldKey ?? null;
    let detectedPharmacyId: number | null = null;
    let status: string;

    if (!rule) {
      status = 'needs_review';
    } else if (!fieldKey || !distributionType) {
      status = 'needs_review';
    } else if (distributionType === 'specific_pharmacy') {
      detectedPharmacyId = rule.pharmacyId;
      if (!detectedPharmacyId) {
        status = 'needs_review';
      } else {
        status = 'pending';
        rvSpecs.push({ txIndex: i, pharmacyId: detectedPharmacyId, fieldKey, amount: transaction.amount, distributionType });
      }
    } else if (distributionType === 'detect_pharmacy_from_text') {
      const detection = detectPharmacyFromAliases(transaction.searchableText, aliases);
      detectedPharmacyId = detection.pharmacyId;
      if (!detection.pharmacyId || detection.ambiguous) {
        status = 'needs_review';
      } else {
        status = 'pending';
        rvSpecs.push({ txIndex: i, pharmacyId: detection.pharmacyId, fieldKey, amount: transaction.amount, distributionType });
      }
    } else if (distributionType === 'split_equally') {
      if (activePharmacies.length === 0) {
        status = 'needs_review';
      } else {
        status = 'pending';
        const shares = splitAmountEqually(transaction.amount, activePharmacies.length);
        for (let j = 0; j < activePharmacies.length; j++) {
          rvSpecs.push({ txIndex: i, pharmacyId: activePharmacies[j].id, fieldKey, amount: shares[j], distributionType });
        }
      }
    } else {
      status = 'needs_review';
    }

    if (status === 'needs_review') needsReviewCount++;

    txInputs.push({
      uploadId,
      transactionDate: transaction.transactionDate,
      amount: transaction.amount,
      counterparty: transaction.counterparty,
      binIin: transaction.binIin,
      paymentPurpose: transaction.paymentPurpose,
      rawRowJson: transaction.rawRowJson,
      searchableText: transaction.searchableText,
      matchedRuleId: rule?.id ?? null,
      detectedPharmacyId,
      targetFieldKey: fieldKey,
      distributionType,
      status,
    });
  }

  const BATCH_SIZE = 200;

  for (let i = 0; i < txInputs.length; i += BATCH_SIZE) {
    await tx.importedTransaction.createMany({ data: txInputs.slice(i, i + BATCH_SIZE) });
  }

  if (rvSpecs.length > 0) {
    const created = await tx.importedTransaction.findMany({
      where: { uploadId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const rvInputs = rvSpecs.map((spec) => ({
      importedTransactionId: created[spec.txIndex].id,
      uploadId,
      pharmacyId: spec.pharmacyId,
      fieldKey: spec.fieldKey,
      amount: spec.amount,
      status: 'pending',
      distributionType: spec.distributionType,
    }));

    for (let i = 0; i < rvInputs.length; i += BATCH_SIZE) {
      await tx.importedReportValue.createMany({ data: rvInputs.slice(i, i + BATCH_SIZE) });
    }
  }

  return {
    importedCount: transactions.length,
    needsReviewCount,
  };
}

export async function regenerateImportedReportValues(
  tx: ImportTx,
  transactionId: number,
  params: {
    fieldKey: string | null;
    distributionType: string | null;
    pharmacyId: number | null;
    status?: string;
    customDistribution?: CustomDistributionItem[] | null;
  }
) {
  const transaction = await tx.importedTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) throw new Error('Транзакция не найдена');

  await tx.importedReportValue.deleteMany({
    where: { importedTransactionId: transactionId },
  });

  const activePharmacies = await tx.pharmacy.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const result = await createReportValues(tx, {
    importedTransactionId: transaction.id,
    uploadId: transaction.uploadId,
    amount: transaction.amount,
    fieldKey: params.fieldKey ?? null,
    distributionType: params.distributionType,
    pharmacyId: params.pharmacyId,
    activePharmacies,
    customDistribution: params.customDistribution,
  });

  const status =
    params.status === 'rejected'
      ? 'rejected'
      : params.status === 'approved' && result.status === 'pending'
      ? 'approved'
      : result.status;

  await tx.importedTransaction.update({
    where: { id: transactionId },
    data: {
      targetFieldKey: params.fieldKey ?? null,
      distributionType: params.distributionType,
      detectedPharmacyId: result.detectedPharmacyId ?? params.pharmacyId,
      customDistribution: (params.customDistribution as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
      status,
    },
  });

  if (status === 'approved') {
    await tx.importedReportValue.updateMany({
      where: { importedTransactionId: transactionId },
      data: { status: 'approved' },
    });
  }

  if (status === 'rejected') {
    await tx.importedReportValue.updateMany({
      where: { importedTransactionId: transactionId },
      data: { status: 'rejected' },
    });
  }

  return { status };
}
