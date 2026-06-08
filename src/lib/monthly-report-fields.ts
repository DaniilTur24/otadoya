export type RowSource = 'db' | 'empty' | 'calc';
export type RowType = 'income' | 'expense' | 'neutral';

export interface MonthlyReportRow {
  key: string;
  label: string;
  source: RowSource;
  rowType?: RowType;
  bold?: boolean;
  section?: boolean;
  indent?: boolean;
  decimals?: number;
}

export const MONTHLY_EXPENSE_KEYS = [
  'goodsExpenses',
  'pharmaBonus',
  'employeeAdvance',
  'pharmaSalary',
  'officeSalary',
  'association',
  'charity',
  'accountingServices',
  'stationery',
  'utilities',
  'deferredTax',
  'vat',
  'security',
  'otherExpenses',
  'householdExpenses',
  'advertising',
  'repairs',
  'rentExpenses',
  'standardKaspibot',
  'daribar',
  'communications',
  'equipment',
  'transport',
  'cleaning',
  'bankServices',
] as const;

export const MONTHLY_REPORT_ROWS: MonthlyReportRow[] = [
  { key: '_rev', label: 'ВЫРУЧКА', section: true, source: 'calc' },
  { key: 'retailRevenue', label: 'ВЫРУЧКА розн в аптеке', source: 'db', bold: true, rowType: 'income' },
  { key: 'kaspiRevenue', label: 'Выручка Каспи', source: 'db', indent: true },
  { key: 'wholesaleRevenue', label: 'ВЫРУЧКА опт', source: 'calc', bold: true },
  { key: 'coefficient', label: 'коэффициент', source: 'db', decimals: 2 },
  { key: 'avgDailyRevenue', label: 'Среднедневная розн выручка', source: 'empty' },
  { key: 'terminalRent', label: 'Аренда терминал', source: 'db', rowType: 'income' },
  { key: 'procedureRent', label: 'Процедурная аренда', source: 'db', rowType: 'income' },
  { key: 'legalEntityProfit', label: 'Прибыль по юрлицам', source: 'empty', rowType: 'income' },
  { key: '_stock', label: 'ОСТАТКИ', section: true, source: 'calc' },
  { key: 'stockRetail', label: 'Остаток товара на конец месяца по розн ценам', source: 'empty' },
  { key: 'stockWholesale', label: 'Остаток товара на конец месяца по оптовым ценам', source: 'empty' },
  { key: 'consignment', label: 'Консигнация', source: 'empty' },
  { key: 'consignmentOverdue', label: 'из них просрочка', source: 'empty', indent: true },
  { key: '_exp', label: 'РАСХОДЫ', section: true, source: 'calc' },
  { key: 'goodsExpenses', label: 'Расходы на товар', source: 'empty', rowType: 'expense' },
  { key: 'pharmaBonus', label: 'Бонусы фарм и зав', source: 'empty', rowType: 'expense' },
  { key: 'employeeAdvance', label: 'Авансы сотрудникам', source: 'empty', rowType: 'expense' },
  { key: 'pharmaSalary', label: 'Оклады фарм и зав', source: 'empty', rowType: 'expense' },
  { key: 'officeSalary', label: 'Зарплата офиса', source: 'empty', rowType: 'expense' },
  { key: 'association', label: 'Ассоциация', source: 'empty', rowType: 'expense' },
  { key: 'charity', label: 'Благотворительность', source: 'empty', rowType: 'expense' },
  { key: 'accountingServices', label: 'Бух.услуги', source: 'empty', rowType: 'expense' },
  { key: 'stationery', label: 'Канцелярские и офисные принадлежности', source: 'empty', rowType: 'expense' },
  { key: 'utilities', label: 'Коммунальные расходы', source: 'empty', rowType: 'expense' },
  { key: 'deferredTax', label: 'Налоги отложенные', source: 'empty', rowType: 'expense' },
  { key: 'vat', label: 'НДС 5% с наценкой 20%', source: 'empty', rowType: 'expense' },
  { key: 'security', label: 'Охрана', source: 'empty', rowType: 'expense' },
  { key: 'otherExpenses', label: 'Прочие расходы', source: 'db', rowType: 'expense' },
  { key: 'householdExpenses', label: 'Расходы на хознужды', source: 'empty', rowType: 'expense' },
  { key: 'advertising', label: 'Расходы на рекламу', source: 'empty', rowType: 'expense' },
  { key: 'repairs', label: 'Расходы на ремонт', source: 'empty', rowType: 'expense' },
  { key: 'rentExpenses', label: 'Расходы по арендной плате', source: 'db', rowType: 'expense' },
  { key: 'standardKaspibot', label: 'Расходы по обслуж.ФА Стандарт Н и Каспибот', source: 'empty', rowType: 'expense' },
  { key: 'daribar', label: 'Расходы Дарибар', source: 'empty', rowType: 'expense' },
  { key: 'communications', label: 'Расходы по связи, интернет, ОФД, Webkassa', source: 'empty', rowType: 'expense' },
  { key: 'equipment', label: 'Техника, мебель', source: 'empty', rowType: 'expense' },
  { key: 'transport', label: 'Транспортные услуги на тер.РК', source: 'empty', rowType: 'expense' },
  { key: 'cleaning', label: 'Уборка территории', source: 'empty', rowType: 'expense' },
  { key: 'bankServices', label: 'Услуги банка без НДС', source: 'db', rowType: 'expense' },
  { key: 'totalExpenses', label: 'ИТОГО РАСХОДЫ', source: 'calc', bold: true },
  { key: 'netIncome', label: 'Чистый доход', source: 'calc', bold: true },
  { key: 'divideBy2', label: 'Разделить на 2', source: 'empty' },
  { key: 'directorShare', label: 'руководителя', source: 'empty' },
];

const expenseKeySet = new Set<string>(MONTHLY_EXPENSE_KEYS);

export const BANK_IMPORT_TARGET_FIELDS = MONTHLY_REPORT_ROWS.filter((row) =>
  expenseKeySet.has(row.key)
).map((row) => ({ key: row.key, label: row.label }));

export function monthlyFieldLabel(key: string | null | undefined): string {
  if (!key) return '—';
  return MONTHLY_REPORT_ROWS.find((row) => row.key === key)?.label ?? key;
}

export function monthlyFieldType(key: string | null | undefined): RowType {
  if (!key) return 'expense';
  return MONTHLY_REPORT_ROWS.find((row) => row.key === key)?.rowType ?? 'expense';
}
