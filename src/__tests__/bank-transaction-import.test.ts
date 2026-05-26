import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  matchTransactionRule,
  detectPharmacyFromAliases,
  splitAmountEqually,
  parseBankTransactionsExcel,
  type ParsedBankTransaction,
} from '@/lib/bank-transaction-import';

vi.mock('@/lib/xlsx-reader', () => ({
  readFirstWorksheetRows: vi.fn(),
  excelSerialDateToDate: (val: number) =>
    new Date(Date.UTC(1900, 0, val - 1)),
}));

import { readFirstWorksheetRows } from '@/lib/xlsx-reader';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction {
  return {
    rowIndex: 0,
    transactionDate: null,
    amount: '1000.00',
    counterparty: null,
    binIin: null,
    paymentPurpose: null,
    rawRowJson: '{}',
    searchableText: '',
    sourceValues: { purpose: '', counterparty: '', bin_iin: '', any_text: '' },
    ...overrides,
  };
}

function makeRule(overrides: Partial<{
  id: number;
  sourceField: string;
  pattern: string;
  matchType: string;
  targetFieldKey: string | null;
  distributionType: string;
  pharmacyId: number | null;
  priority: number;
}> = {}) {
  return {
    id: 1,
    sourceField: 'counterparty',
    pattern: 'kaspi',
    matchType: 'contains',
    targetFieldKey: 'bankServices',
    distributionType: 'specific_pharmacy',
    pharmacyId: 1,
    priority: 0,
    ...overrides,
  };
}

// ─── splitAmountEqually ──────────────────────────────────────────────────────

describe('splitAmountEqually', () => {
  it('splits evenly into equal parts', () => {
    expect(splitAmountEqually('300', 3)).toEqual(['100.00', '100.00', '100.00']);
  });

  it('distributes remainder to the first items', () => {
    // 100 / 3 = 33.33... → [33.34, 33.33, 33.33]
    expect(splitAmountEqually('100', 3)).toEqual(['33.34', '33.33', '33.33']);
  });

  it('sum of parts always equals the original amount', () => {
    const parts = splitAmountEqually('100', 3);
    const sum = parts.reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
    expect(sum).toBe(10000);
  });

  it('returns empty array for 0 parts', () => {
    expect(splitAmountEqually('100', 0)).toEqual([]);
  });

  it('handles single part', () => {
    expect(splitAmountEqually('123.45', 1)).toEqual(['123.45']);
  });

  it('handles string number input', () => {
    const result = splitAmountEqually('1000.00', 4);
    expect(result).toEqual(['250.00', '250.00', '250.00', '250.00']);
  });

  it('handles numeric input', () => {
    const result = splitAmountEqually(99, 3);
    expect(result).toEqual(['33.00', '33.00', '33.00']);
  });
});

// ─── matchTransactionRule ────────────────────────────────────────────────────

describe('matchTransactionRule', () => {
  it('returns null for empty rules list', () => {
    expect(matchTransactionRule(makeTx(), [])).toBeNull();
  });

  it('matches by contains on counterparty field', () => {
    const rule = makeRule({ pattern: 'kaspi' });
    const tx = makeTx({
      sourceValues: { counterparty: 'Kaspi Bank LTD', purpose: '', bin_iin: '', any_text: 'Kaspi Bank LTD' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('does not match when pattern absent', () => {
    const rule = makeRule({ pattern: 'kaspi' });
    const tx = makeTx({
      sourceValues: { counterparty: 'Halyk Bank', purpose: '', bin_iin: '', any_text: 'Halyk Bank' },
    });
    expect(matchTransactionRule(tx, [rule])).toBeNull();
  });

  it('matches by exact', () => {
    const rule = makeRule({ matchType: 'exact', pattern: 'halyk' });
    const tx = makeTx({
      sourceValues: { counterparty: 'halyk', purpose: '', bin_iin: '', any_text: 'halyk' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('exact does not match partial string', () => {
    const rule = makeRule({ matchType: 'exact', pattern: 'halyk' });
    const tx = makeTx({
      sourceValues: { counterparty: 'halyk bank', purpose: '', bin_iin: '', any_text: 'halyk bank' },
    });
    expect(matchTransactionRule(tx, [rule])).toBeNull();
  });

  it('matches by regex', () => {
    const rule = makeRule({ matchType: 'regex', pattern: 'kaspi.*bank' });
    const tx = makeTx({
      sourceValues: { counterparty: 'Kaspi Bank LTD', purpose: '', bin_iin: '', any_text: 'Kaspi Bank LTD' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('skips invalid regex without throwing', () => {
    const rule = makeRule({ matchType: 'regex', pattern: '[invalid' });
    const tx = makeTx({
      sourceValues: { counterparty: 'test', purpose: '', bin_iin: '', any_text: 'test' },
    });
    expect(matchTransactionRule(tx, [rule])).toBeNull();
  });

  it('higher priority rule wins', () => {
    const lowPriority = makeRule({ id: 1, priority: 0, pharmacyId: 1, pattern: 'kaspi' });
    const highPriority = makeRule({ id: 2, priority: 10, pharmacyId: 99, pattern: 'kaspi' });
    const tx = makeTx({
      sourceValues: { counterparty: 'kaspi', purpose: '', bin_iin: '', any_text: 'kaspi' },
    });
    expect(matchTransactionRule(tx, [lowPriority, highPriority])?.pharmacyId).toBe(99);
  });

  it('for equal priority, lower id wins', () => {
    const rule1 = makeRule({ id: 1, priority: 5, pharmacyId: 1, pattern: 'kaspi' });
    const rule2 = makeRule({ id: 2, priority: 5, pharmacyId: 2, pattern: 'kaspi' });
    const tx = makeTx({
      sourceValues: { counterparty: 'kaspi', purpose: '', bin_iin: '', any_text: 'kaspi' },
    });
    expect(matchTransactionRule(tx, [rule2, rule1])?.pharmacyId).toBe(1);
  });

  it('normalises ё→е before matching', () => {
    const rule = makeRule({ sourceField: 'purpose', pattern: 'аптека' });
    const tx = makeTx({
      sourceValues: { purpose: 'Аптёка Центр', counterparty: '', bin_iin: '', any_text: 'Аптёка Центр' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('normalises case before matching', () => {
    const rule = makeRule({ pattern: 'kaspi bank' });
    const tx = makeTx({
      sourceValues: { counterparty: 'KASPI BANK', purpose: '', bin_iin: '', any_text: 'KASPI BANK' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('matches on bin_iin field', () => {
    const rule = makeRule({ sourceField: 'bin_iin', pattern: '123456789' });
    const tx = makeTx({
      sourceValues: { bin_iin: '123456789', counterparty: '', purpose: '', any_text: '123456789' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('matches on purpose field', () => {
    const rule = makeRule({ sourceField: 'purpose', pattern: 'аренда' });
    const tx = makeTx({
      sourceValues: { purpose: 'оплата аренда за январь', counterparty: '', bin_iin: '', any_text: 'оплата аренда за январь' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('matches on any_text field', () => {
    const rule = makeRule({ sourceField: 'any_text', pattern: 'аренда' });
    const tx = makeTx({
      sourceValues: { any_text: 'полный текст аренда офис', counterparty: '', purpose: '', bin_iin: '' },
    });
    expect(matchTransactionRule(tx, [rule])).toBe(rule);
  });

  it('skips rule with empty pattern', () => {
    const rule = makeRule({ pattern: '' });
    const tx = makeTx({
      sourceValues: { counterparty: 'any', purpose: '', bin_iin: '', any_text: 'any' },
    });
    expect(matchTransactionRule(tx, [rule])).toBeNull();
  });
});

// ─── detectPharmacyFromAliases ───────────────────────────────────────────────

describe('detectPharmacyFromAliases', () => {
  const aliases = [
    { pharmacyId: 1, alias: 'Аптека Центр' },
    { pharmacyId: 2, alias: 'Аптека Север' },
  ];

  it('detects a single matching pharmacy', () => {
    expect(detectPharmacyFromAliases('оплата аптека центр ноябрь', aliases)).toEqual({
      pharmacyId: 1,
      ambiguous: false,
    });
  });

  it('returns null when no alias matches', () => {
    expect(detectPharmacyFromAliases('случайный текст', aliases)).toEqual({
      pharmacyId: null,
      ambiguous: false,
    });
  });

  it('returns ambiguous=true when two pharmacies match', () => {
    const result = detectPharmacyFromAliases('аптека центр и аптека север', aliases);
    expect(result.pharmacyId).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it('handles empty aliases array', () => {
    expect(detectPharmacyFromAliases('something', [])).toEqual({
      pharmacyId: null,
      ambiguous: false,
    });
  });

  it('case-insensitive matching', () => {
    expect(detectPharmacyFromAliases('АПТЕКА ЦЕНТР ООО', aliases)).toEqual({
      pharmacyId: 1,
      ambiguous: false,
    });
  });

  it('normalises ё→е', () => {
    const aliasesWithYo = [{ pharmacyId: 3, alias: 'аптека' }];
    expect(detectPharmacyFromAliases('Аптёка №5', aliasesWithYo)).toEqual({
      pharmacyId: 3,
      ambiguous: false,
    });
  });
});

// ─── parseBankTransactionsExcel ──────────────────────────────────────────────

describe('parseBankTransactionsExcel', () => {
  beforeEach(() => {
    vi.mocked(readFirstWorksheetRows).mockReset();
  });

  it('returns empty array when rows < 2', async () => {
    vi.mocked(readFirstWorksheetRows).mockResolvedValue([]);
    expect(await parseBankTransactionsExcel(Buffer.from(''))).toEqual([]);
  });

  it('returns empty array when no header row found', async () => {
    vi.mocked(readFirstWorksheetRows).mockResolvedValue([
      ['foo', 'bar'],
      ['baz', 'qux'],
    ]);
    expect(await parseBankTransactionsExcel(Buffer.from(''))).toEqual([]);
  });

  it('parses a simple transaction row', async () => {
    vi.mocked(readFirstWorksheetRows).mockResolvedValue([
      ['Дата операции', 'Дебет', 'Наименование бенефициара', 'БИН/ИИН', 'Назначение платежа'],
      [new Date('2024-03-15'), 50000, 'ТОО Ромашка', '123456789', 'Оплата за услуги'],
    ]);

    const result = await parseBankTransactionsExcel(Buffer.from(''));
    expect(result).toHaveLength(1);
    expect(result[0].counterparty).toBe('ТОО Ромашка');
    expect(result[0].binIin).toBe('123456789');
    expect(result[0].paymentPurpose).toBe('Оплата за услуги');
    expect(result[0].amount).toBe('50000.00');
    expect(result[0].transactionDate).toEqual(new Date('2024-03-15'));
  });

  it('skips fully empty data rows', async () => {
    vi.mocked(readFirstWorksheetRows).mockResolvedValue([
      ['Дата операции', 'Дебет', 'Назначение платежа'],
      ['', '', ''],
      [new Date('2024-03-15'), 1000, 'Оплата'],
    ]);

    const result = await parseBankTransactionsExcel(Buffer.from(''));
    expect(result).toHaveLength(1);
  });

  it('uses credit column when debit is absent', async () => {
    vi.mocked(readFirstWorksheetRows).mockResolvedValue([
      ['Дата операции', 'Кредит', 'Назначение платежа'],
      [new Date('2024-03-15'), 25000, 'Поступление'],
    ]);

    const result = await parseBankTransactionsExcel(Buffer.from(''));
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe('25000.00');
  });

  it('parses amount with comma as decimal separator', async () => {
    vi.mocked(readFirstWorksheetRows).mockResolvedValue([
      ['Дата операции', 'Сумма', 'Назначение платежа'],
      [new Date('2024-03-15'), '1 234,56', 'Оплата'],
    ]);

    const result = await parseBankTransactionsExcel(Buffer.from(''));
    expect(result[0].amount).toBe('1234.56');
  });
});
