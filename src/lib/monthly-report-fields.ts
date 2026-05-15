export type RowSource = 'db' | 'empty' | 'calc';

export interface MonthlyReportRow {
  key: string;
  label: string;
  source: RowSource;
  bold?: boolean;
  section?: boolean;
  indent?: boolean;
  decimals?: number;
}

export const MONTHLY_EXPENSE_KEYS = [
  'goodsExpenses',
  'pharmaBonus',
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
  'fixedAssets',
  'standardKaspibot',
  'daribar',
  'communications',
  'equipment',
  'transport',
  'cleaning',
  'bankServices',
  'terminalRent',
  'procedureRent',
] as const;

export const MONTHLY_REPORT_ROWS: MonthlyReportRow[] = [
  { key: '_rev', label: 'ВЫРУЧКА', section: true, source: 'calc' },
  { key: 'retailRevenue', label: 'ВЫРУЧКА розн в аптеке', source: 'db', bold: true },
  { key: 'kaspiRevenue', label: 'Выручка Каспи', source: 'empty', indent: true },
  { key: 'wholesaleRevenue', label: 'ВЫРУЧКА опт', source: 'calc', bold: true },
  { key: 'coefficient', label: 'коэффициент', source: 'db', decimals: 2 },
  { key: 'avgDailyRevenue', label: 'Среднедневная розн выручка', source: 'empty' },
  { key: 'terminalRent', label: 'Аренда терминал', source: 'db' },
  { key: 'procedureRent', label: 'Процедурная аренда', source: 'db' },
  { key: 'legalEntityProfit', label: 'Прибыль по юрлицам', source: 'empty' },
  { key: '_stock', label: 'ОСТАТКИ', section: true, source: 'calc' },
  { key: 'stockRetail', label: 'Остаток товара на конец месяца по розн ценам', source: 'empty' },
  { key: 'stockWholesale', label: 'Остаток товара на конец месяца по оптовым ценам', source: 'empty' },
  { key: 'consignment', label: 'Консигнация', source: 'empty' },
  { key: 'consignmentOverdue', label: 'из них просрочка', source: 'empty', indent: true },
  { key: '_exp', label: 'РАСХОДЫ', section: true, source: 'calc' },
  { key: 'goodsExpenses', label: 'Расходы на товар', source: 'empty' },
  { key: 'pharmaBonus', label: 'Бонусы фарм и зав', source: 'empty' },
  { key: 'pharmaSalary', label: 'Оклады фарм и зав', source: 'empty' },
  { key: 'officeSalary', label: 'Зарплата офиса', source: 'empty' },
  { key: 'association', label: 'Ассоциация', source: 'empty' },
  { key: 'charity', label: 'Благотворительность', source: 'empty' },
  { key: 'accountingServices', label: 'Бух.услуги', source: 'empty' },
  { key: 'stationery', label: 'Канцелярские и офисные принадлежности', source: 'empty' },
  { key: 'utilities', label: 'Коммунальные расходы', source: 'empty' },
  { key: 'deferredTax', label: 'Налоги отложенные', source: 'empty' },
  { key: 'vat', label: 'НДС 5% с наценкой 20%', source: 'empty' },
  { key: 'security', label: 'Охрана', source: 'empty' },
  { key: 'otherExpenses', label: 'Прочие расходы', source: 'db' },
  { key: 'householdExpenses', label: 'Расходы на хознужды', source: 'empty' },
  { key: 'advertising', label: 'Расходы на рекламу', source: 'empty' },
  { key: 'repairs', label: 'Расходы на ремонт', source: 'empty' },
  { key: 'rentExpenses', label: 'Расходы по арендной плате', source: 'db' },
  { key: 'fixedAssets', label: 'Расходы по обслуг.ФА', source: 'empty' },
  { key: 'standardKaspibot', label: 'Стандарт Ни Каспибот', source: 'empty' },
  { key: 'daribar', label: 'Расходы Дарибар', source: 'empty' },
  { key: 'communications', label: 'Расходы по связи, интернет, ОФД, Webkassa', source: 'empty' },
  { key: 'equipment', label: 'Техника, мебель', source: 'empty' },
  { key: 'transport', label: 'Транспортные услуги на тер.РК', source: 'empty' },
  { key: 'cleaning', label: 'Уборка территории', source: 'empty' },
  { key: 'bankServices', label: 'Услуги банка без НДС', source: 'db' },
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
