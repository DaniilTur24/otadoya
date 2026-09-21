'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { MONTHLY_REPORT_ROWS, MONTHLY_EXPENSE_KEYS, monthlyFieldType } from '@/lib/monthly-report-fields';
import { SHIFT_OPTIONS, SHIFT_TYPE_LABELS } from '@/lib/shift-types';
import { ATTENDANCE_BASED_TYPES, canGetRevenueShift } from '@/lib/employee-types';
import { AmountInput } from '@/components/AmountInput';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  EXCLUDED_FROM_GENERIC_SUMS, pharmaBonusSum, advanceSum, surchargeSum,
  incomeItemsSum, expenseItemsSum, summarizeEntries, groupEntriesByDate,
} from '@/lib/revenue-summary';
import { suggestDeposit, type CashDayBalance } from '@/lib/cash-balance';

const EXPENSE_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) =>
    !row.section &&
    row.key !== 'employeeAdvance' &&
    (MONTHLY_EXPENSE_KEYS as readonly string[]).includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

const INCOME_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) =>
    !row.section &&
    row.rowType === 'income' &&
    row.source !== 'calc' &&
    !['retailRevenue', 'kaspiRevenue', 'wholesaleRevenue'].includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

// Заведующие видят не весь список статей, а только те, что реально касаются их аптеки —
// остальные (зарплаты офиса, налоги, юрлица и т.п.) им недоступны для выбора.
// «Выручка Каспи» сюда не входит — она уже вводится отдельным полем формы, а не статьёй.
const MANAGER_EXPENSE_KEYS = new Set([
  'terminalRent',
  'procedureRent',
  'goodsExpenses',
  'pharmaBonus',
  'charity',
  'stationery',
  'utilities',
  'otherExpenses',
  'householdExpenses',
  'advertising',
  'repairs',
  'rentExpenses',
  'standardKaspibot',
  'communications',
  'equipment',
  'cleaning',
]);

interface Pharmacy { id: number; name: string }
interface Employee { id: number; name: string; employeeType: string; fiveDayViaAttendance?: boolean; pharmacies: Pharmacy[] }

interface ExpenseItem {
  id: number;
  amount: number;
  category: string | null;
  comment: string | null;
  employeeId: number | null;
}

interface RevenueEntry {
  id: number;
  date: string;
  pharmacy: Pharmacy;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  expenseItems: ExpenseItem[];
  generalComment: string | null;
  employeeId: number | null;
  employeeName: string;
  shiftType: string | null;
  status: string;
  submittedById: number | null;
  excludedFromReport: boolean;
}

interface EditExpenseItem { id: number; amount: string; category: string; comment: string; employeeId: string }
interface EditAvansItem { id: number; employeeId: string; amount: string }
interface EditDoplataItem { id: number; employeeId: string; amount: string; comment: string }

interface EditState {
  pharmacyId: string;
  date: string;
  cashRevenue: string;
  terminalRevenue: string;
  kaspiRevenue: string;
  generalComment: string;
  employeeId: string;
  employeeName: string;
  shiftType: string;
  avansItems: EditAvansItem[];
  doplataItems: EditDoplataItem[];
  expenseItems: EditExpenseItem[];
}

let nextItemId = 1;
function newItem(): EditExpenseItem { return { id: nextItemId++, amount: '', category: '', comment: '', employeeId: '' }; }
function newAvansItem(): EditAvansItem { return { id: nextItemId++, employeeId: '', amount: '' }; }
function newDoplataItem(): EditDoplataItem { return { id: nextItemId++, employeeId: '', amount: '', comment: '' }; }

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU');
}

const ROW_LABEL: Record<string, string> = Object.fromEntries(
  MONTHLY_REPORT_ROWS.filter((r) => !r.section).map((r) => [r.key, r.label])
);

const STATUS_LABELS: Record<string, string> = {
  pending: 'На проверке',
  approved: 'Подтверждена',
  rejected: 'Отклонена',
};
const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

interface CashBalanceResponse {
  configured: boolean;
  openingDate?: string;
  openingBalance: number;
  days: CashDayBalance[];
  comments?: Record<string, string>;
}

// Движение наличных за день, как в карточке счёта: остаток с прошлого дня, выручка,
// выдачи, взнос в банк и остаток на завтра. Взнос вводит только бухгалтер.
function CashDayRow({
  balance,
  hiddenFromTable,
  onSaveDeposit,
}: {
  balance: CashDayBalance;
  /** Деньги, прошедшие через кассу в записях, которых в таблице сейчас не видно. */
  hiddenFromTable: number;
  onSaveDeposit: (amount: number) => Promise<void>;
}) {
  return (
    <tr className="bg-sky-50 border-b-2 border-slate-300">
      <td colSpan={15} className="px-3 py-3">
        <CashDayPanel balance={balance} hiddenFromTable={hiddenFromTable} onSaveDeposit={onSaveDeposit} />
      </td>
    </tr>
  );
}

// Тело кассового блока без табличной обвязки — общее для десктоп-строки (CashDayRow)
// и мобильной карточки дня, чтобы расчёт и вёрстка кассы не разъезжались.
function CashDayPanel({
  balance,
  hiddenFromTable,
  onSaveDeposit,
}: {
  balance: CashDayBalance;
  hiddenFromTable: number;
  onSaveDeposit: (amount: number) => Promise<void>;
}) {
  const [value, setValue] = useState(balance.deposit ? String(balance.deposit) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(balance.deposit ? String(balance.deposit) : '');
  }, [balance.deposit]);

  const suggested = suggestDeposit(balance.balanceBeforeDeposit);

  const parsed = value ? parseFloat(value) : 0;
  const changed = Number.isFinite(parsed) && parsed !== balance.deposit;

  async function commit() {
    if (saving || !changed) return;
    setSaving(true);
    await onSaveDeposit(parsed);
    setSaving(false);
  }

  async function applySuggested() {
    if (saving) return;
    setSaving(true);
    setValue(String(suggested));
    await onSaveDeposit(suggested);
    setSaving(false);
  }

  return (
    <div className="max-w-xl text-sm">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Касса</div>

      <CashLine label="Остаток с прошлого дня" value={fmt(balance.openingBalance)} />
      <CashLine label="+ Выручка наличными" value={fmt(balance.cashRevenue)} valueClass="text-green-700" />
      <CashLine label="− Выдано из кассы" value={fmt(balance.cashExpenses)} valueClass="text-red-600" />
      <CashLine label="= В кассе на конец дня" value={fmt(balance.balanceBeforeDeposit)} strong />

          <div className="flex items-center gap-2 py-1 border-t border-sky-200 mt-1 pt-1.5">
            <span className="text-slate-600 w-52 shrink-0">− Сдано в банк</span>
            <AmountInput
              className="input w-36 py-0.5 text-sm text-right"
              placeholder="0"
              value={value}
              onChange={setValue}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
              }}
            />
            {saving ? (
              <span className="text-xs text-slate-400">сохранение…</span>
            ) : changed ? (
              <button type="button" className="btn-primary text-xs py-0.5 px-2" onClick={commit}>
                Сохранить
              </button>
            ) : (
              suggested > 0 && suggested !== balance.deposit && (
                <button
                  type="button"
                  className={`text-xs underline whitespace-nowrap ${
                    balance.unconfirmed !== 0
                      ? 'text-amber-700 hover:text-amber-900'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title={
                    balance.unconfirmed !== 0
                      ? 'Внимание: сумма посчитана с учётом записей на проверке. Если их отклонить, в кассе окажется меньше.'
                      : 'Подставить весь остаток кассы. Сумму можно поправить.'
                  }
                  // Не даём полю потерять фокус по нажатию: иначе onBlur успевал записать
                  // старое значение параллельно с этим сохранением.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applySuggested}
                >
                  сдать всё: {fmt(suggested)}
                </button>
              )
            )}
          </div>

          <div className="border-t border-sky-200 mt-1 pt-1.5">
            <CashLine
              label="= Остаток на завтра"
              value={fmt(balance.closingBalance)}
              valueClass={balance.closingBalance >= 0 ? 'text-slate-900' : 'text-red-700'}
              strong
            />
            {balance.unconfirmed !== 0 && (
              <>
                <CashLine
                  label="в т. ч. не подтверждено"
                  value={fmt(balance.unconfirmed)}
                  valueClass="text-amber-700"
                  note={
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold leading-none cursor-help shrink-0"
                      title={`В остатке учтены записи на проверке — накопительно, вместе с прошлыми днями. Подтверждение ничего не изменит, а отклонение уменьшит остаток на ${fmt(balance.unconfirmed)} и сдвинет все последующие дни.`}
                    >
                      !
                    </span>
                  }
                />
                <CashLine
                  label="остаток без них"
                  value={fmt(balance.closingBalance - balance.unconfirmed)}
                  valueClass="text-slate-500"
                />
              </>
            )}
          </div>

          {hiddenFromTable !== 0 && (
            <p className="text-xs text-slate-500 mt-1">
              В таблице выше показаны не все записи этого дня: фильтр скрывает {fmt(hiddenFromTable)} движения по кассе.
            </p>
          )}
        </div>
  );
}

// Строка кассового столбика: подпись слева, сумма в колонке справа, примечание за ней.
function CashLine({
  label, value, valueClass, strong, note,
}: {
  label: string;
  value: string;
  valueClass?: string;
  strong?: boolean;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-slate-600 w-52 shrink-0">{label}</span>
      <span className={`w-36 text-right tabular-nums ${strong ? 'font-semibold' : ''} ${valueClass ?? 'text-slate-900'}`}>
        {value}
      </span>
      {note}
    </div>
  );
}

// Одна метрика в строке дня: подпись слева, число справа в колонке фиксированной ширины,
// чтобы числа выстраивались друг под другом и день с днём можно было сравнивать взглядом.
function DayMetric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="w-44 shrink-0 flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <strong className={className ?? 'text-slate-900'}>{value}</strong>
    </span>
  );
}

// Заголовок дня. Сам день виден всегда, смены внутри раскрываются по клику — иначе
// за месяц набирается столько строк, что итоги в них тонут.
function DaySummaryRow({
  dateKey, entries, balance, expanded, showPharmacy, showCash, onToggle,
}: {
  dateKey: string;
  entries: RevenueEntry[];
  balance: CashDayBalance | undefined;
  expanded: boolean;
  /** При фильтре по одной аптеке её название в каждой строке — лишний шум. */
  showPharmacy: boolean;
  /** Держим место под «В кассе», только если остаток вообще считается в этом срезе. */
  showCash: boolean;
  onToggle: () => void;
}) {
  const s = summarizeEntries(entries);
  const pharmacyNames = [...new Set(entries.map((e) => e.pharmacy.name))];
  const hasPending = entries.some((e) => e.status === 'pending');

  return (
    <tr
      className={`border-y border-slate-300 cursor-pointer ${expanded ? 'bg-slate-200/70' : 'bg-slate-100 hover:bg-slate-200/60'}`}
      onClick={onToggle}
    >
      <td colSpan={15} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
          <span className="w-32 shrink-0 font-semibold text-slate-900 flex items-center gap-1.5">
            <span className="text-slate-400 w-3">{expanded ? '▾' : '▸'}</span>
            {fmtDate(dateKey)}
          </span>
          {showPharmacy && (
            <span className="w-40 shrink-0 text-slate-500 truncate" title={pharmacyNames.join(', ')}>
              {pharmacyNames.length === 1 ? pharmacyNames[0] : `${pharmacyNames.length} аптеки`}
            </span>
          )}

          <DayMetric label="Выручка" value={fmt(s.totalRevenue)} className="text-green-700" />
          <DayMetric
            label="Наличными"
            value={fmt(s.cashNet)}
            className={s.cashNet >= 0 ? 'text-slate-900' : 'text-red-700'}
          />
          {balance ? (
            <DayMetric
              label="В кассе"
              value={fmt(balance.closingBalance)}
              className={balance.closingBalance >= 0 ? 'text-slate-900' : 'text-red-700'}
            />
          ) : showCash ? (
            <span className="w-44 shrink-0" />
          ) : null}

          <span className="text-xs text-slate-400">
            {entries.length === 1 ? '1 смена' : `${entries.length} смен`}
          </span>
          {hasPending && <span className="text-xs text-amber-700">есть записи на проверке</span>}
          {balance && balance.deposit > 0 && (
            <span className="text-xs text-slate-500">сдано в банк {fmt(balance.deposit)}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// Итог по колонкам — виден только когда день раскрыт, чтобы числа стояли ровно
// под теми же колонками, что и у смен выше.
function DayTotalRow({ entries }: { entries: RevenueEntry[] }) {
  const s = summarizeEntries(entries);

  return (
    <tr className="bg-slate-50 border-t border-slate-300 font-semibold text-slate-900">
      <td className="td text-right text-slate-500 font-normal text-xs" colSpan={3}>
        Итого за день
      </td>
      <td className="td text-right text-green-700 whitespace-nowrap">{fmt(s.totalCash)}</td>
      <td className="td text-right text-green-700 whitespace-nowrap">{fmt(s.totalTerminal)}</td>
      <td className="td text-right text-green-700 whitespace-nowrap">{s.totalKaspi > 0 ? fmt(s.totalKaspi) : '—'}</td>
      <td className="td text-right text-green-700 whitespace-nowrap">{s.totalIncomes > 0 ? fmt(s.totalIncomes) : '—'}</td>
      <td className="td text-right text-red-600 whitespace-nowrap">{s.totalBonuses > 0 ? fmt(s.totalBonuses) : '—'}</td>
      <td className="td text-right text-red-600 whitespace-nowrap">{s.totalAdvances > 0 ? fmt(s.totalAdvances) : '—'}</td>
      <td className="td text-right text-red-600 whitespace-nowrap">{s.totalSurcharges > 0 ? fmt(s.totalSurcharges) : '—'}</td>
      <td className="td text-right text-green-700 whitespace-nowrap">{fmt(s.totalRevenue)}</td>
      <td className="td text-right text-red-600 whitespace-nowrap">{s.totalExpenses > 0 ? fmt(s.totalExpenses) : '—'}</td>
      <td className="td" colSpan={2} />
      <td className="td bg-slate-50 border-l border-slate-300 sticky right-0 z-10" />
    </tr>
  );
}

// Мобильный аналог DaySummaryRow — тот же расчёт, но карточкой вместо табличной строки.
function DaySummaryCard({
  dateKey, entries, balance, expanded, showPharmacy, onToggle,
}: {
  dateKey: string;
  entries: RevenueEntry[];
  balance: CashDayBalance | undefined;
  expanded: boolean;
  showPharmacy: boolean;
  onToggle: () => void;
}) {
  const s = summarizeEntries(entries);
  const pharmacyNames = [...new Set(entries.map((e) => e.pharmacy.name))];
  const hasPending = entries.some((e) => e.status === 'pending');

  return (
    <div
      className={`px-3 py-2.5 cursor-pointer ${expanded ? 'bg-slate-200/70' : 'bg-slate-100 active:bg-slate-200/60'}`}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900 flex items-center gap-1.5">
          <span className="text-slate-400 w-3">{expanded ? '▾' : '▸'}</span>
          {fmtDate(dateKey)}
        </span>
        <span className="text-xs text-slate-400 shrink-0">
          {entries.length === 1 ? '1 смена' : `${entries.length} смен`}
        </span>
      </div>
      {showPharmacy && (
        <div className="text-xs text-slate-500 truncate mt-0.5 pl-[18px]" title={pharmacyNames.join(', ')}>
          {pharmacyNames.length === 1 ? pharmacyNames[0] : `${pharmacyNames.length} аптеки`}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm mt-1.5 pl-[18px]">
        <span className="text-slate-500">Выручка <strong className="text-green-700">{fmt(s.totalRevenue)}</strong></span>
        <span className="text-slate-500">
          Наличными <strong className={s.cashNet >= 0 ? 'text-slate-900' : 'text-red-700'}>{fmt(s.cashNet)}</strong>
        </span>
        {balance && (
          <span className="text-slate-500">
            В кассе <strong className={balance.closingBalance >= 0 ? 'text-slate-900' : 'text-red-700'}>{fmt(balance.closingBalance)}</strong>
          </span>
        )}
      </div>
      {(hasPending || (balance && balance.deposit > 0)) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 pl-[18px] text-xs">
          {hasPending && <span className="text-amber-700">есть записи на проверке</span>}
          {balance && balance.deposit > 0 && <span className="text-slate-500">сдано в банк {fmt(balance.deposit)}</span>}
        </div>
      )}
    </div>
  );
}

// Мобильный аналог DayTotalRow — те же суммы, вёрстка сеткой вместо колонок таблицы.
function DayTotalCard({ entries }: { entries: RevenueEntry[] }) {
  const s = summarizeEntries(entries);

  return (
    <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-sm">
      <div className="text-xs text-slate-500 mb-1">Итого за день</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Нал.</span><span className="text-green-700 font-medium">{fmt(s.totalCash)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Терм.</span><span className="text-green-700 font-medium">{fmt(s.totalTerminal)}</span></div>
        {s.totalKaspi > 0 && (
          <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Каспи</span><span className="text-green-700 font-medium">{fmt(s.totalKaspi)}</span></div>
        )}
        {s.totalIncomes > 0 && (
          <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Доп. доходы</span><span className="text-green-700 font-medium">{fmt(s.totalIncomes)}</span></div>
        )}
        <div className="flex justify-between col-span-2 pt-1 mt-1 border-t border-slate-200 font-semibold">
          <span className="text-slate-700">Выручка</span>
          <span className="text-green-700">{fmt(s.totalRevenue)}</span>
        </div>
        {s.totalBonuses > 0 && (
          <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Бонусы</span><span className="text-red-600">{fmt(s.totalBonuses)}</span></div>
        )}
        {s.totalAdvances > 0 && (
          <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Зарплаты</span><span className="text-red-600">{fmt(s.totalAdvances)}</span></div>
        )}
        {s.totalSurcharges > 0 && (
          <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Доплаты</span><span className="text-red-600">{fmt(s.totalSurcharges)}</span></div>
        )}
        {s.totalExpenses > 0 && (
          <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Расходы</span><span className="text-red-600">{fmt(s.totalExpenses)}</span></div>
        )}
      </div>
    </div>
  );
}

export default function RevenueListPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [pendingEntries, setPendingEntries] = useState<RevenueEntry[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [moderating, setModerating] = useState<number | null>(null);
  const [moderateComment, setModerateComment] = useState('');

  const [filterPharmacy, setFilterPharmacy] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  // '' — статус по умолчанию (для admin/bookkeeper это approved/rejected, pending скрыт —
  // см. load(); чтобы явно посмотреть pending с фильтрами по аптеке/датам, нужно выбрать статус)
  const [filterStatus, setFilterStatus] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const editSnapshotRef = useRef<string | null>(null);

  // Остаток в кассе считается только по одной аптеке: у каждой свой ящик, и общий
  // «остаток по всем аптекам» смысла не имеет. Грузится отдельно от записей, потому что
  // остаток на начало периода зависит от всей истории до него, а не от видимых строк.
  const [cashBalance, setCashBalance] = useState<CashBalanceResponse | null>(null);
  // Дни свёрнуты по умолчанию: за месяц набирается слишком много строк, чтобы читать их подряд.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const [tooltipEntry, setTooltipEntry] = useState<RevenueEntry | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Плавающий горизонтальный скроллбар для таблицы записей — прилипает к низу окна,
  // пока таблица частично на экране, чтобы не листать вниз через все записи до обычного скроллбара.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const floatingScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const [showFloatingScrollbar, setShowFloatingScrollbar] = useState(false);
  const [floatingBarRect, setFloatingBarRect] = useState({ left: 0, width: 0 });
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const handleTableScroll = () => {
    if (syncingScrollRef.current) { syncingScrollRef.current = false; return; }
    if (floatingScrollRef.current && tableScrollRef.current) {
      syncingScrollRef.current = true;
      floatingScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  };
  const handleFloatingScroll = () => {
    if (syncingScrollRef.current) { syncingScrollRef.current = false; return; }
    if (floatingScrollRef.current && tableScrollRef.current) {
      syncingScrollRef.current = true;
      tableScrollRef.current.scrollLeft = floatingScrollRef.current.scrollLeft;
    }
  };

  // Сотрудники с табельной оплатой (manager_fixed/cleaner/office/pharmacy_manager) не привязаны
  // к смене в записи выручки — их зарплата считается только через табель посещаемости.
  const shiftEligibleEmployees = employees.filter((e) => !ATTENDANCE_BASED_TYPES.has(e.employeeType));
  const editSelectedEmployee = editState ? employees.find((e) => e.id === Number(editState.employeeId)) : undefined;
  // "Пятидневщик, у которого блокируется смена" — сейчас это только seller. manager_trading
  // с тем же флагом может совмещать оба источника (см. canGetRevenueShift).
  const isEditFiveDayEmployee = Boolean(editSelectedEmployee && !canGetRevenueShift(editSelectedEmployee));
  // Аванс/доплату можно назначить только сотруднику, привязанному к аптеке этой записи —
  // кроме office: они получают деньги из кассы любой аптеки (см. дозагрузку ниже).
  const editPharmacyEmployees = editState
    ? employees.filter((e) => e.employeeType === 'office' || e.pharmacies.some((p) => p.id === Number(editState.pharmacyId)))
    : [];

  useEffect(() => {
    fetch('/api/pharmacies').then((r) => r.json()).then(setPharmacies);
    fetch('/api/employees?isActive=true').then((r) => r.json()).then(setEmployees);
  }, []);

  // Общий список employees (загруженный выше без pharmacyId) для заведующего уже ограничен
  // его аптеками на сервере, поэтому не содержит office-сотрудников без привязки к его аптекам.
  // При открытии/смене аптеки в форме редактирования дозагружаем сотрудников именно этой
  // аптеки — сервер сам подмешивает в ответ всех office (см. /api/employees).
  useEffect(() => {
    if (!editState?.pharmacyId) return;
    fetch(`/api/employees?isActive=true&pharmacyId=${editState.pharmacyId}`)
      .then((r) => r.json())
      .then((fetched: Employee[]) => {
        setEmployees((prev) => {
          const known = new Set(prev.map((e) => e.id));
          const additions = fetched.filter((e) => !known.has(e.id));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
      });
  }, [editState?.pharmacyId]);

  const load = useCallback(async () => {
    setLoading(true);
    const roleRes = await fetch('/api/auth/me').then((r) => r.json());
    const currentRole: string = roleRes.role ?? '';
    setRole(currentRole);
    setUserId(typeof roleRes.userId === 'number' ? roleRes.userId : null);

    const isModeratorRole = currentRole === 'admin' || currentRole === 'bookkeeper';

    const fetchAll = fetch(`/api/revenue?status=all${filterPharmacy ? `&pharmacyId=${filterPharmacy}` : ''}`);
    const fetchPending = isModeratorRole ? fetch('/api/revenue?status=pending') : Promise.resolve(null);

    const [allRes, pendingRes] = await Promise.all([fetchAll, fetchPending]);

    let data: RevenueEntry[] = await allRes.json();
    // Для admin/bookkeeper pending по умолчанию скрыт из основной таблицы (он уже виден в панели
    // модерации выше) — но если бухгалтер явно выбрал статус в фильтре (например 'pending', чтобы
    // сверить остаток по конкретной аптеке/периоду), показываем ровно этот статус.
    if (filterStatus) {
      data = data.filter((e) => e.status === filterStatus);
    } else {
      // По умолчанию — подтверждённые и на проверке: ровно то, что считает касса.
      // Отклонённая запись недействительна, денег по ней не было, поэтому её тут нет.
      data = data.filter((e) => e.status !== 'rejected');
    }

    if (filterFrom) data = data.filter((e) => e.date >= filterFrom);
    if (filterTo)   data = data.filter((e) => e.date <= filterTo + 'T23:59:59');
    setEntries(data);
    setSelectedIds(new Set());

    if (pendingRes) {
      const pending: RevenueEntry[] = await pendingRes.json();
      setPendingEntries(pending);
    } else {
      setPendingEntries([]);
    }
    setLoading(false);
  }, [filterPharmacy, filterFrom, filterTo, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const loadCashBalance = useCallback(async () => {
    const isModeratorRole = role === 'admin' || role === 'bookkeeper';
    if (!filterPharmacy || !isModeratorRole) {
      setCashBalance(null);
      return;
    }
    const params = new URLSearchParams({ pharmacyId: filterPharmacy });
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);

    const res = await fetch(`/api/cash-balance?${params}`);
    if (!res.ok) { setCashBalance(null); return; }
    setCashBalance(await res.json());
  }, [filterPharmacy, filterFrom, filterTo, role]);

  useEffect(() => { loadCashBalance(); }, [loadCashBalance]);

  function toggleDay(dateKey: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  async function saveCashMovement(date: string, amount: number) {
    await fetch('/api/cash-balance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pharmacyId: Number(filterPharmacy), date, amount }),
    });
    // Взнос меняет остаток не только своего дня, но и всех следующих — перечитываем целиком.
    await loadCashBalance();
  }

  async function approveEntry(id: number) {
    if (!confirm('Подтвердить запись?')) return;
    await fetch(`/api/revenue/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookkeeperComment: moderateComment || null }),
    });
    setModerating(null);
    setModerateComment('');
    load();
    loadCashBalance();
  }

  function startEdit(entry: RevenueEntry) {
    setEditingId(entry.id);
    setSaveError('');
    // Форма появляется прямо под этой записью — если для неё (или для другой) было открыто
    // окно модерации, закрываем его, чтобы под одной строкой не было двух развёрнутых блоков.
    setModerating(null);
    setModerateComment('');

    // Существующие авансы/доплата (если есть) редактируются через выделенные поля
    // «Аванс сотруднику» / «Доплата сотруднику» ниже, а не как обычные строки в
    // «Дополнительных статьях» — иначе можно случайно добавить их туда повторно.
    const advanceItems = entry.expenseItems.filter((i) => i.category === 'employeeAdvance');
    const surchargeItems = entry.expenseItems.filter((i) => i.category === 'employeeSurcharge');

    const initialState: EditState = {
      pharmacyId: String(entry.pharmacy.id),
      date: entry.date.split('T')[0],
      cashRevenue: String(entry.cashRevenue),
      terminalRevenue: String(entry.terminalRevenue),
      kaspiRevenue: String(entry.kaspiRevenue ?? 0),
      generalComment: entry.generalComment ?? '',
      employeeId: entry.employeeId ? String(entry.employeeId) : '',
      employeeName: entry.employeeName,
      shiftType: entry.shiftType ?? '',
      avansItems: advanceItems.map((i) => ({
        id: nextItemId++,
        employeeId: i.employeeId ? String(i.employeeId) : '',
        amount: String(i.amount),
      })),
      doplataItems: surchargeItems.map((i) => {
        const rawComment = i.comment ?? '';
        const separatorIndex = rawComment.indexOf(' — ');
        return {
          id: nextItemId++,
          employeeId: i.employeeId ? String(i.employeeId) : '',
          amount: String(i.amount),
          comment: separatorIndex !== -1 ? rawComment.slice(separatorIndex + 3) : '',
        };
      }),
      expenseItems: entry.expenseItems
        .filter((i) => !surchargeItems.includes(i) && !advanceItems.includes(i))
        .map((i) => ({
          id: nextItemId++,
          amount: String(i.amount),
          category: i.category ?? '',
          comment: i.comment ?? '',
          employeeId: i.employeeId ? String(i.employeeId) : '',
        })),
    };
    setEditState(initialState);
    editSnapshotRef.current = JSON.stringify(initialState);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState(null);
    setSaveError('');
    editSnapshotRef.current = null;
  }

  const isEditDirty = Boolean(
    editState && editSnapshotRef.current !== null && JSON.stringify(editState) !== editSnapshotRef.current
  );

  useUnsavedChangesGuard(isEditDirty && !saving);

  function requestCancelEdit() {
    if (isEditDirty && !window.confirm('Данные не сохранены. Уйти со страницы?')) return;
    cancelEdit();
  }

  function updateField(field: keyof Omit<EditState, 'expenseItems' | 'avansItems' | 'doplataItems'>, value: string) {
    setEditState((s) => {
      if (!s) return s;
      const updated = { ...s, [field]: value };
      if (field === 'employeeId') {
        const emp = employees.find((e) => e.id === Number(value));
        updated.employeeName = emp ? emp.name : s.employeeName;
        // У чисто табельного пятидневщика (seller) зарплата считается только по табелю — смену
        // в записи выручки ему не назначаем. manager_trading с тем же флагом — исключение.
        if (emp && !canGetRevenueShift(emp)) {
          updated.shiftType = '';
        }
      }
      return updated;
    });
  }

  function addExpenseItem() {
    setEditState((s) => s ? { ...s, expenseItems: [...s.expenseItems, newItem()] } : s);
  }
  function removeExpenseItem(id: number) {
    setEditState((s) => s ? { ...s, expenseItems: s.expenseItems.filter((i) => i.id !== id) } : s);
  }
  function updateExpenseItem(id: number, field: 'amount' | 'category' | 'comment' | 'employeeId', value: string) {
    setEditState((s) =>
      s ? { ...s, expenseItems: s.expenseItems.map((i) => i.id === id ? { ...i, [field]: value } : i) } : s
    );
  }

  function addAvansItem() {
    setEditState((s) => s ? { ...s, avansItems: [...s.avansItems, newAvansItem()] } : s);
  }
  function removeAvansItem(id: number) {
    setEditState((s) => s ? { ...s, avansItems: s.avansItems.filter((i) => i.id !== id) } : s);
  }
  function updateAvansItem(id: number, field: 'employeeId' | 'amount', value: string) {
    setEditState((s) =>
      s ? { ...s, avansItems: s.avansItems.map((i) => i.id === id ? { ...i, [field]: value } : i) } : s
    );
  }

  function addDoplataItem() {
    setEditState((s) => s ? { ...s, doplataItems: [...s.doplataItems, newDoplataItem()] } : s);
  }
  function removeDoplataItem(id: number) {
    setEditState((s) => s ? { ...s, doplataItems: s.doplataItems.filter((i) => i.id !== id) } : s);
  }
  function updateDoplataItem(id: number, field: 'employeeId' | 'amount' | 'comment', value: string) {
    setEditState((s) =>
      s ? { ...s, doplataItems: s.doplataItems.map((i) => i.id === id ? { ...i, [field]: value } : i) } : s
    );
  }

  const PROTECTED_CATEGORY_LABELS: Record<string, string> = {
    employeeAdvance: 'Зарплата',
    employeeSurcharge: 'Доплата',
  };

  interface RevenueDeleteImpact {
    revenue: { pharmacyName: string; before: number; after: number } | null;
    employees: { employeeId: number; employeeName: string; before: number; after: number }[];
    partial: boolean;
  }

  function money(n: number): string {
    return `${n.toLocaleString('ru-RU')} ₸`;
  }

  // Удаление подтверждённой записи меняет не только сам факт выручки — выручка аптеки и
  // зарплата вовлечённых сотрудников (сменная оплата, аванс/доплата другому сотруднику из
  // DailyExpenseItem.employeeId, см. CLAUDE.md) пересчитаются вместе с ней. Бэкенд считает
  // это заранее (см. computeRevenueDeleteImpact) и возвращает 409 с конкретными суммами
  // «было → станет» — здесь показываем их и удаляем только после явного подтверждения.
  async function deleteRevenueEntry(id: number): Promise<boolean> {
    const res = await fetch(`/api/revenue/${id}`, { method: 'DELETE' });
    if (res.ok) return true;

    let data: { error?: string; items?: { employeeName: string; category: string; amount: number }[]; impact?: RevenueDeleteImpact } | null = null;
    try { data = await res.json(); } catch { /* тело не JSON — ниже покажем общее сообщение */ }

    if (res.status === 409 && data?.error === 'revenue_delete_impact') {
      const lines: string[] = [];

      if (data.impact?.revenue) {
        const { pharmacyName, before, after } = data.impact.revenue;
        lines.push(`Выручка «${pharmacyName}» за месяц: ${money(before)} → ${money(after)}`);
      }
      for (const emp of data.impact?.employees ?? []) {
        lines.push(`Зарплата ${emp.employeeName} за месяц: ${money(emp.before)} → ${money(emp.after)}`);
      }
      for (const item of data.items ?? []) {
        lines.push(`— ${PROTECTED_CATEGORY_LABELS[item.category] ?? item.category} сотруднику ${item.employeeName} (${money(item.amount)}) будет удалён вместе с записью`);
      }
      const caveat = data.impact?.partial
        ? '\n\nПремия/лестница/доля бонуса могут измениться дополнительно — здесь не учтено, точная сумма появится после удаления.'
        : '';

      const proceed = confirm(
        `⚠️ Эта запись подтверждена — при удалении пересчитаются:\n\n${lines.join('\n')}${caveat}\n\nВсё равно удалить запись целиком?`
      );
      if (!proceed) return false;
      const retry = await fetch(`/api/revenue/${id}?force=1`, { method: 'DELETE' });
      if (!retry.ok) {
        alert('Не удалось удалить запись');
        return false;
      }
      return true;
    }

    alert(data?.error || 'Не удалось удалить запись');
    return false;
  }

  async function deleteEntry(id: number) {
    if (!confirm('Удалить запись? Это действие нельзя отменить.')) return;
    if (!(await deleteRevenueEntry(id))) return;
    if (editingId === id) cancelEdit();
    load();
    loadCashBalance();
  }

  function toggleSelect(id: number) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((s) =>
      s.size === manageableEntries.length ? new Set() : new Set(manageableEntries.map((e) => e.id))
    );
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} выбранных записей? Это действие нельзя отменить.`)) return;
    // Последовательно, не Promise.all — deleteRevenueEntry может показать подтверждение по
    // каждой записи отдельно (см. deleteRevenueEntry), параллельные confirm() наложились бы друг на друга.
    for (const id of selectedIds) {
      await deleteRevenueEntry(id);
    }
    if (editingId !== null && selectedIds.has(editingId)) cancelEdit();
    load();
    loadCashBalance();
  }

  async function saveEdit() {
    if (!editState || editingId === null) return;

    if (!isEditFiveDayEmployee && !editState.shiftType) {
      if (!confirm('Без типа смены зарплата фармацевта не рассчитается, вы уверены?')) {
        return;
      }
    }

    setSaving(true);
    setSaveError('');

    const validItems = editState.expenseItems.filter((i) => parseFloat(i.amount) > 0);
    const missingCategory = validItems.find((i) => !i.category);
    if (missingCategory) {
      setSaveError('Выберите категорию расхода для каждой строки');
      setSaving(false);
      return;
    }
    const missingSurchargeEmployee = validItems.find((i) => i.category === 'employeeSurcharge' && !i.employeeId);
    if (missingSurchargeEmployee) {
      setSaveError('Выберите сотрудника, которому положена доплата');
      setSaving(false);
      return;
    }

    const validAvansItems = editState.avansItems.filter((i) => parseFloat(i.amount) > 0);
    const missingAvansEmployee = validAvansItems.find((i) => !i.employeeId);
    if (missingAvansEmployee) {
      setSaveError('Выберите сотрудника, которому выдана зарплата');
      setSaving(false);
      return;
    }

    const validDoplataItems = editState.doplataItems.filter((i) => parseFloat(i.amount) > 0);
    const missingDoplataEmployee = validDoplataItems.find((i) => !i.employeeId);
    if (missingDoplataEmployee) {
      setSaveError('Выберите сотрудника, которому положена доплата');
      setSaving(false);
      return;
    }

    const employeeName = editState.employeeName.trim();
    if (!employeeName) {
      setSaveError('Выберите сотрудника из списка');
      setSaving(false);
      return;
    }

    type SubmitExpenseItem = { amount: string; category: string | null; comment: string | null; employeeId: number | null };
    const allExpenseItems: SubmitExpenseItem[] = validItems.map((i) => ({
      amount: i.amount,
      category: i.category || null,
      comment: i.comment || null,
      employeeId: (i.category === 'employeeAdvance' || i.category === 'employeeSurcharge') && i.employeeId ? Number(i.employeeId) : null,
    }));
    for (const item of validAvansItems) {
      const avansEmployee = employees.find((e) => e.id === Number(item.employeeId));
      allExpenseItems.push({
        amount: item.amount,
        category: 'employeeAdvance',
        comment: avansEmployee ? `Зарплата: ${avansEmployee.name}` : null,
        employeeId: Number(item.employeeId),
      });
    }
    for (const item of validDoplataItems) {
      const doplataEmployee = employees.find((e) => e.id === Number(item.employeeId));
      const label = doplataEmployee ? `Доплата: ${doplataEmployee.name}` : 'Доплата';
      allExpenseItems.push({
        amount: item.amount,
        category: 'employeeSurcharge',
        comment: item.comment.trim() ? `${label} — ${item.comment.trim()}` : label,
        employeeId: Number(item.employeeId),
      });
    }

    if (!window.confirm('Все данные введены верно? Сохранить?')) {
      setSaving(false);
      return;
    }

    const res = await fetch(`/api/revenue/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pharmacyId: Number(editState.pharmacyId),
        date: editState.date,
        cashRevenue: editState.cashRevenue || '0',
        terminalRevenue: editState.terminalRevenue || '0',
        kaspiRevenue: editState.kaspiRevenue || '0',
        generalComment: editState.generalComment || null,
        employeeId: editState.employeeId ? Number(editState.employeeId) : null,
        employeeName,
        shiftType: editState.shiftType || null,
        expenseItems: allExpenseItems,
      }),
    });

    if (res.ok) { cancelEdit(); load(); loadCashBalance(); }
    else { const d = await res.json(); setSaveError(d.error || 'Ошибка сохранения'); }
    setSaving(false);
  }

  const totalExpenses = editState
    ? editState.expenseItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    : 0;

  // Заведующие видят тот же список полей, что и бухгалтер/админ, но статья ограничена
  // списком MANAGER_EXPENSE_KEYS — остальные статьи им не нужны и не показываются.
  const isManager = role === 'manager';
  const expenseOptions = isManager
    ? EXPENSE_OPTIONS.filter((opt) => MANAGER_EXPENSE_KEYS.has(opt.key))
    : EXPENSE_OPTIONS;
  const incomeOptions = isManager
    ? INCOME_OPTIONS.filter((opt) => MANAGER_EXPENSE_KEYS.has(opt.key))
    : INCOME_OPTIONS;

  const avansTotal = editState
    ? editState.avansItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    : 0;

  const doplataTotal = editState
    ? editState.doplataItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    : 0;

  const totalRevenue =
    editState
      ? (parseFloat(editState.cashRevenue) || 0) +
        (parseFloat(editState.terminalRevenue) || 0) +
        (parseFloat(editState.kaspiRevenue) || 0)
      : 0;

  // Список сотрудников для фильтра берём из уже загруженных записей (а не из мастер-списка
  // employees) — так он автоматически ограничивается аптекой, если выбран filterPharmacy,
  // поскольку entries уже отфильтрованы по ней на сервере.
  const employeeFilterOptions = Array.from(
    new Map(
      entries
        .filter((e) => e.employeeId !== null)
        .map((e) => [e.employeeId as number, e.employeeName])
    ).entries()
  )
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const visibleEntries = filterEmployee
    ? entries.filter((e) => String(e.employeeId) === filterEmployee)
    : entries;

  // Заведующий может изменять/удалять только свою же запись, пока она на проверке —
  // после подтверждения/отклонения бухгалтером кнопки скрываются (см. canModifyEntry на сервере).
  function canManageEntry(entry: RevenueEntry) {
    if (role === 'admin' || role === 'bookkeeper') return true;
    if (role === 'manager') return entry.status === 'pending' && entry.submittedById === userId;
    return false;
  }

  const manageableEntries = visibleEntries.filter(canManageEntry);

  useEffect(() => {
    const container = tableScrollRef.current;
    if (!container) return;

    const updateMetrics = () => {
      const rect = container.getBoundingClientRect();
      setTableScrollWidth(container.scrollWidth);
      setFloatingBarRect({ left: rect.left, width: rect.width });
      const hasOverflow = container.scrollWidth > container.clientWidth + 1;
      const scrollbarBelowViewport = rect.bottom > window.innerHeight;
      const tableVisible = rect.top < window.innerHeight && rect.bottom > 0;
      setShowFloatingScrollbar(hasOverflow && scrollbarBelowViewport && tableVisible);
    };

    updateMetrics();
    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(container);
    window.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
    };
  }, [visibleEntries]);

  function renderEditForm() {
    if (!editState) return null;
    return (
        <div className="card p-4 border-slate-400 border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Редактирование записи</h2>
            <button onClick={requestCancelEdit} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>

          {saveError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {saveError}
            </div>
          )}

          {/* Аптека и дата */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">Аптека</label>
              <select className="input" value={editState.pharmacyId}
                onChange={(e) => updateField('pharmacyId', e.target.value)}>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Дата</label>
              <input type="date" className="input" value={editState.date}
                onChange={(e) => updateField('date', e.target.value)} />
            </div>
          </div>

          {/* Сотрудник и смена */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="label">Сотрудник</label>
              {shiftEligibleEmployees.length > 0 ? (
                <>
                  <select className="input" value={editState.employeeId}
                    onChange={(e) => updateField('employeeId', e.target.value)} required>
                    <option value="">— выберите из списка —</option>
                    {shiftEligibleEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">
                    Нет нужного?{' '}
                    <a href="/employees" target="_blank" className="text-slate-700 hover:underline">
                      Добавить сотрудника
                    </a>
                  </p>
                </>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Нет сотрудников со сменной оплатой.{' '}
                  <a href="/employees" target="_blank" className="font-medium underline">
                    Добавить сотрудников
                  </a>
                </div>
              )}
            </div>
            <div>
              <label className="label">Тип смены</label>
              <select className="input" value={editState.shiftType}
                onChange={(e) => updateField('shiftType', e.target.value)}
                disabled={isEditFiveDayEmployee}>
                <option value="">— не указан —</option>
                {SHIFT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {isEditFiveDayEmployee ? (
                <p className="mt-1 text-xs text-slate-400">
                  У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смена здесь не назначается
                </p>
              ) : !editState.shiftType && (
                <p className="mt-1 text-xs text-amber-600">Без типа смены зарплата не рассчитается</p>
              )}
            </div>
          </div>

          {/* Выручка */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="label">Наличные</label>
              <AmountInput className="input"
                value={editState.cashRevenue}
                onChange={(value) => updateField('cashRevenue', value)} />
            </div>
            <div>
              <label className="label">Терминал</label>
              <AmountInput className="input"
                value={editState.terminalRevenue}
                onChange={(value) => updateField('terminalRevenue', value)} />
            </div>
            <div>
              <label className="label">
                Каспи
                <span className="ml-1 text-slate-400 font-normal text-xs">— входит в общую</span>
              </label>
              <AmountInput className="input"
                value={editState.kaspiRevenue}
                onChange={(value) => updateField('kaspiRevenue', value)} />
            </div>
          </div>

          {totalRevenue > 0 && (
            <div className="bg-slate-100 border border-slate-300 rounded px-3 py-2 text-sm text-slate-900 mb-3">
              Итого выручка: <strong>{totalRevenue.toLocaleString('ru-RU')}</strong>
            </div>
          )}

          {/* Дополнительные статьи — заведующие видят тот же список полей, но статья
              ограничена MANAGER_EXPENSE_KEYS; бухгалтер/админ видят полный список статей */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Дополнительные статьи</label>
              <button type="button" onClick={addExpenseItem}
                className="text-sm text-slate-700 hover:text-slate-900 font-medium">
                + Добавить строку
              </button>
            </div>
            {editState.expenseItems.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Нет записей</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid gap-2 text-xs text-slate-400 font-medium px-5"
                  style={{ gridTemplateColumns: '1.5rem 6rem 1fr 8rem 1.5rem' }}>
                  <span></span><span>Сумма</span><span>Статья *</span><span>Примечание</span><span></span>
                </div>
                {editState.expenseItems.map((item, idx) => (
                  <div key={item.id}>
                    <div className="grid gap-2 items-start"
                      style={{ gridTemplateColumns: '1.5rem 6rem 1fr 8rem 1.5rem' }}>
                      <span className="text-xs text-slate-400 mt-2.5 text-right pr-1">{idx + 1}.</span>
                      <AmountInput placeholder="0.00"
                        className="input" value={item.amount}
                        onChange={(value) => updateExpenseItem(item.id, 'amount', value)} />
                      <select className="input" value={item.category} required
                        onChange={(e) => updateExpenseItem(item.id, 'category', e.target.value)}>
                        <option value="">— статья —</option>
                        <optgroup label="Расходы">
                          {expenseOptions.map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Доходы">
                          {incomeOptions.map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                          ))}
                        </optgroup>
                      </select>
                      <input type="text" placeholder="необязательно"
                        className="input" value={item.comment}
                        onChange={(e) => updateExpenseItem(item.id, 'comment', e.target.value)} />
                      <button type="button" onClick={() => removeExpenseItem(item.id)}
                        className="mt-2 text-slate-300 hover:text-red-500 transition-colors text-lg leading-none">
                        ×
                      </button>
                    </div>
                    {item.category === 'pharmaBonus' && (
                      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 mt-1 ml-5">
                        Эта сумма пойдёт в расходы и будет учтена в зарплате сотрудника за месяц.
                      </p>
                    )}
                    {item.category === 'employeeSurcharge' && (
                      <div className="mt-1 ml-5 space-y-1">
                        <select className="input" value={item.employeeId} required
                          onChange={(e) => updateExpenseItem(item.id, 'employeeId', e.target.value)}>
                          <option value="">— кому доплата —</option>
                          {editPharmacyEmployees.map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                          Эта сумма пойдёт в расходы и прибавится к зарплате сотрудника за месяц. В статистику бонусов не входит.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {editState.expenseItems.length > 1 && (
                  <p className="text-sm text-slate-600 pl-5 pt-1">
                    Итого: <strong>{totalExpenses.toLocaleString('ru-RU')}</strong>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Аванс — может быть выдан другому сотруднику этой аптеки, не обязательно тому, кто на смене; можно добавить несколько за день */}
          <div className="rounded border border-slate-300 p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Зарплата сотруднику <span className="text-slate-400 font-normal">— необязательно</span></label>
              <button type="button" onClick={addAvansItem}
                className="text-sm text-slate-700 hover:text-slate-900 font-medium">
                + Добавить зарплату
              </button>
            </div>
            {editState.avansItems.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Нет зарплат</p>
            ) : (
              <div className="space-y-2">
                {editState.avansItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                    <div>
                      <AmountInput
                        value={item.amount}
                        onChange={(value) => updateAvansItem(item.id, 'amount', value)}
                        placeholder="Сумма зарплаты"
                        className="input"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2 items-center">
                      <select
                        className="input"
                        value={item.employeeId}
                        onChange={(e) => updateAvansItem(item.id, 'employeeId', e.target.value)}
                        disabled={editPharmacyEmployees.length === 0}
                      >
                        <option value="">— кому выдана зарплата —</option>
                        {editPharmacyEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeAvansItem(item.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors text-xl leading-none shrink-0"
                        title="Удалить">
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {avansTotal > 0 && (
              <p className="mt-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                Будет вычтен из накопленной зарплаты выбранного сотрудника и учтён как расход аптеки и наличные на руках за день.
              </p>
            )}
          </div>

          {/* Доплата — персональная надбавка сотруднику, отдельно от общих бонусов аптеки (pharmaBonus);
              может быть выдана другому сотруднику этой аптеки, не обязательно тому, кто на смене;
              можно добавить несколько за день. */}
          <div className="rounded border border-slate-300 p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Доплата сотруднику <span className="text-slate-400 font-normal">— необязательно</span></label>
              <button type="button" onClick={addDoplataItem}
                className="text-sm text-slate-700 hover:text-slate-900 font-medium">
                + Добавить доплату
              </button>
            </div>
            {editState.doplataItems.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Нет доплат</p>
            ) : (
              <div className="space-y-2">
                {editState.doplataItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-start">
                    <div>
                      <AmountInput
                        value={item.amount}
                        onChange={(value) => updateDoplataItem(item.id, 'amount', value)}
                        placeholder="Сумма доплаты"
                        className="input"
                      />
                    </div>
                    <div>
                      <select
                        className="input"
                        value={item.employeeId}
                        onChange={(e) => updateDoplataItem(item.id, 'employeeId', e.target.value)}
                        disabled={editPharmacyEmployees.length === 0}
                      >
                        <option value="">— кому доплата —</option>
                        {editPharmacyEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex gap-2 items-center">
                      <input
                        type="text"
                        value={item.comment}
                        onChange={(e) => updateDoplataItem(item.id, 'comment', e.target.value)}
                        placeholder="Комментарий (за что доплата)"
                        className="input flex-1"
                      />
                      <button type="button" onClick={() => removeDoplataItem(item.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors text-xl leading-none shrink-0"
                        title="Удалить">
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {doplataTotal > 0 && (
              <p className="mt-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                Прибавится к зарплате выбранного сотрудника и будет учтена как расход аптеки. На наличные на руках за день не влияет. В статистику бонусов не входит.
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className="label">Общий комментарий</label>
            <textarea rows={2} className="input resize-none"
              value={editState.generalComment}
              onChange={(e) => updateField('generalComment', e.target.value)} />
          </div>

          <div className="flex gap-3">
            <button className="btn-primary" onClick={saveEdit} disabled={saving}>
              {saving && <span className="spinner" />}{saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
            <button className="btn-secondary" onClick={requestCancelEdit}>Отмена</button>
          </div>
        </div>
    );
  }

  // Снимает пометку "не учитывается" с записи (общая функция для таблицы и карточек).
  async function includeInReport(entry: RevenueEntry) {
    const d = new Date(entry.date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const { isClosed } = await fetch(`/api/months/close?year=${year}&month=${month}`).then((r) => r.json());
    if (isClosed) {
      alert('Месяц закрыт. Чтобы включить эту запись в отчёт, сначала откройте месяц в разделе «Закрытие месяца».');
      return;
    }
    await fetch(`/api/revenue/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excludedFromReport: false }),
    });
    load();
    loadCashBalance();
  }

  // Общие для десктоп-таблицы и мобильных карточек производные значения строки —
  // считаем один раз на запись, чтобы не дублировать формулы в обоих рендерах.
  function getEntryDerived(entry: RevenueEntry) {
    return {
      bonuses: pharmaBonusSum(entry.expenseItems),
      advances: advanceSum(entry.expenseItems),
      surcharges: surchargeSum(entry.expenseItems),
      incomes: incomeItemsSum(entry.expenseItems),
      expenses: expenseItemsSum(entry.expenseItems),
      isEditingThis: editingId === entry.id,
      isModeratingThis: moderating === entry.id,
      canModerate: (role === 'admin' || role === 'bookkeeper') && entry.status === 'pending',
    };
  }

  // Панель подтверждения/отклонения pending-записи — используется и в десктоп-таблице
  // (внутри colSpan-строки), и в мобильной карточке (напрямую).
  function renderModeratePanel(entry: RevenueEntry) {
    return (
      <>
        {entry.expenseItems.length > 0 && (
          <div className="mb-3 text-sm">
            <p className="font-medium text-slate-700 mb-1">Расходы:</p>
            <ul className="space-y-0.5">
              {entry.expenseItems.map((item) => (
                <li key={item.id} className="text-slate-600 flex gap-2">
                  <span className="text-red-600">{fmt(item.amount)}</span>
                  <span>{ROW_LABEL[item.category ?? ''] ?? item.category ?? '—'}</span>
                  {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {entry.generalComment && (
          <p className="text-sm text-slate-500 italic mb-3">{entry.generalComment}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 items-start">
          <input
            type="text"
            className="input flex-1"
            placeholder="Комментарий бухгалтера (необязательно)"
            value={moderateComment}
            onChange={(e) => setModerateComment(e.target.value)}
          />
          {/* «Отклонить» убрано: отклонённая запись прощала выданный из неё аванс
              и запирала день для заведующей. Неверную запись бухгалтер правит
              («Изменить») или удаляет («Удалить»). */}
          <div className="flex gap-2 shrink-0 w-full sm:w-auto">
            <button className="btn-success text-sm flex-1 sm:flex-none" onClick={() => approveEntry(entry.id)}>
              Подтвердить
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-900">Записи выручки</h1>
        <Link href="/revenue/new" className="btn-primary text-sm">+ Добавить</Link>
      </div>
      <p className="text-slate-500 text-sm mb-4">
        Все введённые бухгалтером записи. Нажмите «Изменить» для редактирования.
      </p>

      {/* Напоминание о pending-записях — только счётчик, без разворачивания. Клик выставляет
          фильтр «Статус: На проверке» ниже, где записи можно смотреть с фильтрами по аптеке/датам. */}
      {(role === 'admin' || role === 'bookkeeper') && pendingEntries.length > 0 && filterStatus !== 'pending' && (
        <button
          className="mb-4 flex items-center gap-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 hover:bg-amber-100 transition-colors"
          onClick={() => setFilterStatus('pending')}
        >
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500 text-white text-xs font-bold">
            {pendingEntries.length}
          </span>
          {pendingEntries.length === 1 ? 'запись на проверке' : 'записей на проверке'} — нажмите, чтобы посмотреть
        </button>
      )}

      {/* Фильтры */}
      <div className="card p-3 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
          <div className="sm:col-span-2">
            <DateRangeFilter
              from={filterFrom}
              to={filterTo}
              onChange={(from, to) => { setFilterFrom(from); setFilterTo(to); }}
            />
          </div>
          <div>
            <label className="label">Аптека</label>
            <select className="input" value={filterPharmacy}
              onChange={(e) => { setFilterPharmacy(e.target.value); setFilterEmployee(''); }}>
              <option value="">Все аптеки</option>
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Сотрудник</label>
            <select className="input" value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              disabled={employeeFilterOptions.length === 0}>
              <option value="">Все сотрудники</option>
              {employeeFilterOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Статус</label>
            <select className="input" value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">Все</option>
              <option value="pending">На проверке</option>
              <option value="approved">Подтверждена</option>
              <option value="rejected">Отклонена</option>
            </select>
          </div>
          <div>
            <button className="btn-warning w-full" onClick={() => {
              setFilterFrom(''); setFilterTo(''); setFilterPharmacy(''); setFilterEmployee(''); setFilterStatus('');
            }}>
              Сбросить
            </button>
          </div>
        </div>
        {(role === 'admin' || role === 'bookkeeper') && (
          <div className="mt-3 flex justify-end">
            <a
              className="btn-secondary text-sm"
              href={`/api/reports/cash-export?${new URLSearchParams({
                ...(filterPharmacy ? { pharmacyId: filterPharmacy } : {}),
                ...(filterFrom ? { from: filterFrom } : {}),
                ...(filterTo ? { to: filterTo } : {}),
                ...(filterStatus ? { status: filterStatus } : {}),
              }).toString()}`}
              title="Отчёт по кассе (приход/расход/остаток) за выбранный период, аптеку и статус — без учёта фильтра по сотруднику"
            >
              Скачать Excel (отчёт по кассе)
            </a>
          </div>
        )}
      </div>

      {/* Почему не видно остатка в кассе */}
      {(role === 'admin' || role === 'bookkeeper') && !loading && (
        filterPharmacy && cashBalance && !cashBalance.configured ? (
          <div className="mb-3 px-3 py-2 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900">
            Остаток в кассе не считается: не задана точка отсчёта. Укажите в{' '}
            <Link href={`/settings/pharmacies/${filterPharmacy}`} className="underline">
              настройках аптеки
            </Link>{' '}
            дату и сумму, которая реально была в кассе на утро этого дня.
          </div>
        ) : !filterPharmacy ? (
          <div className="mb-3 px-3 py-2 rounded border border-slate-200 bg-slate-50 text-sm text-slate-500">
            Выберите аптеку в фильтре, чтобы видеть остаток в кассе по дням — у каждой аптеки своя касса.
          </div>
        ) : null
      )}

      {/* Таблица записей */}
      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : visibleEntries.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">
          {filterEmployee ? 'Нет записей этого сотрудника за выбранный период' : 'Нет записей за выбранный период'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Дни свёрнуты — нажмите на день, чтобы посмотреть смены и кассу
            </span>
            <button
              className="text-slate-600 underline hover:text-slate-900 text-xs"
              onClick={() => {
                if (expandedDays.size > 0) {
                  setExpandedDays(new Set());
                } else {
                  const allDays = groupEntriesByDate(visibleEntries).map((g) => g.dateKey);
                  setExpandedDays(new Set(allDays));
                }
              }}
            >
              {expandedDays.size > 0 ? 'Свернуть все' : 'Развернуть все'}
            </button>
          </div>
          {selectedIds.size > 0 && (
            <div className="px-4 py-2 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
              <span className="text-sm text-slate-900">Выбрано: {selectedIds.size}</span>
              <button className="btn-danger text-xs" onClick={deleteSelected}>
                Удалить выбранные
              </button>
            </div>
          )}
          <div className="hidden md:block overflow-x-auto" ref={tableScrollRef} onScroll={handleTableScroll}>
            <table className="w-full [&_.td]:px-1.5 [&_.td]:py-1 [&_.th]:px-1.5 [&_.th]:py-1">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th w-8">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={manageableEntries.length > 0 && selectedIds.size === manageableEntries.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="th">Дата</th>
                  <th className="th">Аптека</th>
                  <th className="th text-right">Нал.</th>
                  <th className="th text-right">Терм.</th>
                  <th className="th text-right">Каспи</th>
                  <th className="th text-right">Доп. доходы</th>
                  <th className="th text-right">Бонусы</th>
                  <th className="th text-right">Зарплаты</th>
                  <th className="th text-right">Доплаты</th>
                  <th className="th text-right">Выручка</th>
                  <th className="th text-right">Расходы</th>
                  <th className="th">Сотрудник</th>
                  <th className="th">Статус</th>
                  <th className="th border-l border-slate-300 sticky right-0 z-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupEntriesByDate(visibleEntries).map((group) => {
                  const dayBalance = cashBalance?.configured
                    ? cashBalance.days.find((d) => d.date === group.dateKey)
                    : undefined;
                  const isExpanded = expandedDays.has(group.dateKey);
                  return (
                  <React.Fragment key={group.dateKey}>
                    <DaySummaryRow
                      dateKey={group.dateKey}
                      entries={group.entries}
                      balance={dayBalance}
                      expanded={isExpanded}
                      showPharmacy={!filterPharmacy}
                      showCash={Boolean(cashBalance?.configured)}
                      onToggle={() => toggleDay(group.dateKey)}
                    />
                {isExpanded && group.entries.map((entry) => {
                  const { bonuses, advances, surcharges, incomes, expenses, isEditingThis, isModeratingThis, canModerate } =
                    getEntryDerived(entry);
                  const rowBg = isEditingThis
                    ? 'bg-slate-100'
                    : entry.status === 'pending'
                    ? 'bg-amber-50/40 hover:bg-amber-50/70'
                    : 'hover:bg-slate-50';
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className={`group ${rowBg}`}
                        onMouseEnter={(e) => {
                          if (entry.expenseItems.length > 0 || entry.generalComment) {
                            setTooltipEntry(entry);
                            setTooltipPos({ x: e.clientX, y: e.clientY });
                          }
                        }}
                        onMouseLeave={() => setTooltipEntry(null)}>
                        <td className="td">
                          {canManageEntry(entry) && (
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={selectedIds.has(entry.id)}
                              onChange={() => toggleSelect(entry.id)}
                            />
                          )}
                        </td>
                        <td className="td whitespace-nowrap">{fmtDate(entry.date)}</td>
                        <td className="td font-medium max-w-[110px] truncate" title={entry.pharmacy.name}>{entry.pharmacy.name}</td>
                        <td className="td text-right text-green-700 whitespace-nowrap">{fmt(entry.cashRevenue)}</td>
                        <td className="td text-right text-green-700 whitespace-nowrap">{fmt(entry.terminalRevenue)}</td>
                        <td className="td text-right text-green-700 whitespace-nowrap">
                          {entry.kaspiRevenue > 0 ? fmt(entry.kaspiRevenue) : '—'}
                        </td>
                        <td className="td text-right text-green-700 whitespace-nowrap">
                          {incomes > 0 ? fmt(incomes) : '—'}
                        </td>
                        <td className="td text-right text-red-600 whitespace-nowrap">
                          {bonuses > 0 ? fmt(bonuses) : '—'}
                        </td>
                        <td className="td text-right text-red-600 whitespace-nowrap">
                          {advances > 0 ? fmt(advances) : '—'}
                        </td>
                        <td className="td text-right text-red-600 whitespace-nowrap">
                          {surcharges > 0 ? fmt(surcharges) : '—'}
                        </td>
                        <td className="td text-right font-semibold text-green-700 whitespace-nowrap">
                          {fmt(entry.totalRevenue)}
                        </td>
                        <td className="td text-right text-red-600 whitespace-nowrap">
                          {expenses > 0 ? fmt(expenses) : '—'}
                        </td>
                        <td className="td text-slate-500 max-w-[130px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="truncate" title={entry.employeeName}>{entry.employeeName}</span>
                            {entry.excludedFromReport && (
                              <button
                                className="text-xs px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                                title="Нажмите чтобы включить в отчёт за этот месяц"
                                onClick={() => includeInReport(entry)}
                              >
                                не учитывается
                              </button>
                            )}
                          </div>
                          {entry.shiftType && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              entry.shiftType === 'full_day'
                                ? 'bg-slate-200 text-slate-800'
                                : 'bg-slate-100 text-slate-800'
                            }`}>
                              {SHIFT_TYPE_LABELS[entry.shiftType] ?? entry.shiftType}
                            </span>
                          )}
                        </td>
                        <td className="td">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                            STATUS_CLASSES[entry.status] ?? 'bg-slate-100 text-slate-600'
                          }`}>
                            {STATUS_LABELS[entry.status] ?? entry.status}
                          </span>
                        </td>
                        <td
                          className={`td border-l border-slate-300 sticky right-0 z-10 ${
                            isEditingThis ? 'bg-slate-100' : entry.status === 'pending' ? 'bg-amber-50 group-hover:bg-amber-100' : 'bg-white group-hover:bg-slate-50'
                          }`}
                        >
                          {isEditingThis ? (
                            <span className="text-xs text-slate-700 font-medium whitespace-nowrap">Редактируется</span>
                          ) : isModeratingThis ? (
                            <button
                              className="text-xs text-slate-400 hover:text-slate-600"
                              onClick={() => { setModerating(null); setModerateComment(''); }}
                            >
                              Закрыть
                            </button>
                          ) : canManageEntry(entry) ? (
                            <div className="flex gap-1">
                              {canModerate && (
                                <button
                                  className="btn-warning text-xs"
                                  onClick={() => { setModerating(entry.id); setModerateComment(''); }}
                                >
                                  Проверить
                                </button>
                              )}
                              <button className="btn-secondary text-xs" onClick={() => startEdit(entry)}>
                                Изменить
                              </button>
                              <button className="btn-danger text-xs" onClick={() => deleteEntry(entry.id)}>
                                Удалить
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300 whitespace-nowrap">—</span>
                          )}
                        </td>
                      </tr>
                      {isModeratingThis && !isEditingThis && (
                        <tr key={`${entry.id}-moderate`} className="bg-amber-50/60">
                          <td colSpan={15} className="px-4 py-3">
                            {renderModeratePanel(entry)}
                          </td>
                        </tr>
                      )}
                      {isEditingThis && (
                        <tr key={`${entry.id}-edit`} className="bg-slate-50">
                          <td colSpan={15} className="px-4 py-3">
                            {renderEditForm()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                    {isExpanded && <DayTotalRow entries={group.entries} />}
                    {isExpanded && dayBalance && (() => {
                      const visible = summarizeEntries(group.entries);
                      const visibleCashFlow =
                        visible.totalCash - visible.totalBonuses - visible.totalAdvances - visible.totalExpenses;
                      const balanceCashFlow = dayBalance.cashRevenue - dayBalance.cashExpenses;
                      return (
                        <CashDayRow
                          balance={dayBalance}
                          hiddenFromTable={balanceCashFlow - visibleCashFlow}
                          onSaveDeposit={(amount) => saveCashMovement(group.dateKey, amount)}
                        />
                      );
                    })()}
                  </React.Fragment>
                );})}
              </tbody>
            </table>
          </div>

          {/* Мобильная версия — карточки вместо таблицы, та же информация и те же действия,
              просто без горизонтальной прокрутки по 13 колонкам. */}
          <div className="md:hidden divide-y divide-slate-200">
            {groupEntriesByDate(visibleEntries).map((group) => {
              const dayBalance = cashBalance?.configured
                ? cashBalance.days.find((d) => d.date === group.dateKey)
                : undefined;
              const isExpanded = expandedDays.has(group.dateKey);
              return (
                <div key={group.dateKey}>
                  <DaySummaryCard
                    dateKey={group.dateKey}
                    entries={group.entries}
                    balance={dayBalance}
                    expanded={isExpanded}
                    showPharmacy={!filterPharmacy}
                    onToggle={() => toggleDay(group.dateKey)}
                  />
                  {isExpanded && (
                    <div className="divide-y divide-slate-100">
                      {group.entries.map((entry) => {
              const { bonuses, advances, surcharges, incomes, expenses, isEditingThis, isModeratingThis, canModerate } =
                getEntryDerived(entry);
              const cardBg = isEditingThis ? 'bg-slate-100' : entry.status === 'pending' ? 'bg-amber-50/40' : '';

              if (isEditingThis) {
                return (
                  <div key={entry.id} className={`p-3 ${cardBg}`}>
                    {renderEditForm()}
                  </div>
                );
              }

              return (
                <div key={entry.id} className={`p-3 ${cardBg}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2 min-w-0">
                      {canManageEntry(entry) && (
                        <input
                          type="checkbox"
                          className="rounded mt-1 shrink-0"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelect(entry.id)}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{fmtDate(entry.date)}</div>
                        <div className="text-sm text-slate-500 truncate">{entry.pharmacy.name}</div>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                      STATUS_CLASSES[entry.status] ?? 'bg-slate-100 text-slate-600'
                    }`}>
                      {STATUS_LABELS[entry.status] ?? entry.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mb-2">
                    <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Нал.</span><span className="text-green-700 font-medium">{fmt(entry.cashRevenue)}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Терм.</span><span className="text-green-700 font-medium">{fmt(entry.terminalRevenue)}</span></div>
                    {entry.kaspiRevenue > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Каспи</span><span className="text-green-700 font-medium">{fmt(entry.kaspiRevenue)}</span></div>
                    )}
                    {incomes > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Доп. доходы</span><span className="text-green-700 font-medium">{fmt(incomes)}</span></div>
                    )}
                    <div className="flex justify-between col-span-2 pt-1 mt-1 border-t border-slate-100">
                      <span className="text-slate-600 font-medium">Выручка</span>
                      <span className="text-green-700 font-semibold">{fmt(entry.totalRevenue)}</span>
                    </div>
                    {bonuses > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Бонусы</span><span className="text-red-600">{fmt(bonuses)}</span></div>
                    )}
                    {advances > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Зарплаты</span><span className="text-red-600">{fmt(advances)}</span></div>
                    )}
                    {surcharges > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Доплаты</span><span className="text-red-600">{fmt(surcharges)}</span></div>
                    )}
                    {expenses > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Расходы</span><span className="text-red-600">{fmt(expenses)}</span></div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-sm mb-2">
                    <span className="text-slate-500 truncate">{entry.employeeName}</span>
                    {entry.shiftType && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        entry.shiftType === 'full_day' ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-800'
                      }`}>
                        {SHIFT_TYPE_LABELS[entry.shiftType] ?? entry.shiftType}
                      </span>
                    )}
                    {entry.excludedFromReport && (
                      <button
                        className="text-xs px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                        title="Нажмите чтобы включить в отчёт за этот месяц"
                        onClick={() => includeInReport(entry)}
                      >
                        не учитывается
                      </button>
                    )}
                  </div>

                  {entry.generalComment && !isModeratingThis && (
                    <p className="text-sm text-slate-500 italic mb-2">{entry.generalComment}</p>
                  )}

                  {isModeratingThis ? (
                    <div className="mt-2 pt-2 border-t border-amber-200">
                      {renderModeratePanel(entry)}
                      <button
                        className="btn-secondary text-xs mt-2 w-full"
                        onClick={() => { setModerating(null); setModerateComment(''); }}
                      >
                        Закрыть
                      </button>
                    </div>
                  ) : canManageEntry(entry) ? (
                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      {canModerate && (
                        <button className="btn-warning text-sm flex-1" onClick={() => { setModerating(entry.id); setModerateComment(''); }}>
                          Проверить
                        </button>
                      )}
                      <button className="btn-secondary text-sm flex-1" onClick={() => startEdit(entry)}>Изменить</button>
                      <button className="btn-danger text-sm flex-1" onClick={() => deleteEntry(entry.id)}>Удалить</button>
                    </div>
                  ) : null}
                </div>
              );
                      })}
                    </div>
                  )}
                  {isExpanded && <DayTotalCard entries={group.entries} />}
                  {isExpanded && dayBalance && (() => {
                    const visible = summarizeEntries(group.entries);
                    const visibleCashFlow =
                      visible.totalCash - visible.totalBonuses - visible.totalAdvances - visible.totalExpenses;
                    const balanceCashFlow = dayBalance.cashRevenue - dayBalance.cashExpenses;
                    return (
                      <div className="bg-sky-50 border-t-2 border-slate-300 px-3 py-3">
                        <CashDayPanel
                          balance={dayBalance}
                          hiddenFromTable={balanceCashFlow - visibleCashFlow}
                          onSaveDeposit={(amount) => saveCashMovement(group.dateKey, amount)}
                        />
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* Плавающий горизонтальный скроллбар — прилипает к низу окна, пока таблица на экране,
              чтобы не нужно было листать вниз через все записи ради обычного нижнего скроллбара. */}
          {showFloatingScrollbar && (
            <div
              ref={floatingScrollRef}
              onScroll={handleFloatingScroll}
              style={{ position: 'fixed', bottom: 0, left: floatingBarRect.left, width: floatingBarRect.width, zIndex: 30 }}
              className="overflow-x-auto overflow-y-hidden h-3 bg-slate-100 border-t border-slate-300"
            >
              <div style={{ width: tableScrollWidth, height: 1 }} />
            </div>
          )}

          {/* Итого */}
          {(() => {
            const {
              totalRevenue, totalCash, totalTerminal, totalKaspi, totalIncomes,
              totalBonuses, totalAdvances, totalSurcharges, totalExpenses, total, cashNet,
            } = summarizeEntries(visibleEntries);
            return (
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-300 flex flex-wrap gap-4 text-sm">
                <span className="text-slate-500">Итого по подтверждённым записям:</span>
                <span>Выручка: <strong className="text-green-700">{fmt(totalRevenue)}</strong></span>
                <span className="text-slate-500">
                  нал. <strong className="text-slate-700">{fmt(totalCash)}</strong>
                  {' · '}терм. <strong className="text-slate-700">{fmt(totalTerminal)}</strong>
                  {totalKaspi > 0 && <>{' · '}каспи <strong className="text-slate-700">{fmt(totalKaspi)}</strong></>}
                </span>
                {totalIncomes > 0 && (
                  <span>Доп. доходы: <strong className="text-green-700">{fmt(totalIncomes)}</strong></span>
                )}
                {totalBonuses > 0 && (
                  <span>Бонусы: <strong className="text-red-600">{fmt(totalBonuses)}</strong></span>
                )}
                {totalAdvances > 0 && (
                  <span>Зарплаты: <strong className="text-red-600">{fmt(totalAdvances)}</strong></span>
                )}
                {totalSurcharges > 0 && (
                  <span>Доплаты: <strong className="text-red-600">{fmt(totalSurcharges)}</strong></span>
                )}
                {totalExpenses > 0 && (
                  <span>Расходы: <strong className="text-red-600">{fmt(totalExpenses)}</strong></span>
                )}
                <span className="border-l border-slate-300 pl-6">
                  Итого: <strong className={total >= 0 ? 'text-green-700' : 'text-red-700'}>{fmt(total)}</strong>
                </span>
                <span className="border-l border-slate-300 pl-6">
                  Наличными на руках: <strong className={cashNet >= 0 ? 'text-green-700' : 'text-red-700'}>{fmt(cashNet)}</strong>
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {tooltipEntry && (() => {
        const items = tooltipEntry.expenseItems.filter(i => !EXCLUDED_FROM_GENERIC_SUMS.has(i.category ?? ''));
        const bonusItems = tooltipEntry.expenseItems.filter(i => i.category === 'pharmaBonus');
        const advanceItems = tooltipEntry.expenseItems.filter(i => i.category === 'employeeAdvance');
        const surchargeItems = tooltipEntry.expenseItems.filter(i => i.category === 'employeeSurcharge');
        const hasContent = items.length > 0 || bonusItems.length > 0 || advanceItems.length > 0 || surchargeItems.length > 0 || tooltipEntry.generalComment;
        if (!hasContent) return null;
        return (
          <div
            style={{ position: 'fixed', left: tooltipPos.x + 16, top: tooltipPos.y + 8, zIndex: 9999 }}
            className="bg-white border border-slate-300 rounded p-3 text-xs max-w-sm pointer-events-none"
          >
            {items.length > 0 && (
              <div className="space-y-1.5">
                {items.map((item) => {
                  const type = monthlyFieldType(item.category);
                  const colorClass = type === 'income' ? 'text-green-700' : 'text-orange-700';
                  const label = ROW_LABEL[item.category ?? ''] ?? item.category ?? 'Без статьи';
                  return (
                    <div key={item.id} className="flex gap-2 items-baseline">
                      <span className={`font-semibold shrink-0 ${colorClass}`}>{fmt(item.amount)}</span>
                      <span className="text-slate-700">{label}</span>
                      {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {bonusItems.length > 0 && (
              <div className={`space-y-1.5 ${items.length > 0 ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {bonusItems.map((item) => (
                  <div key={item.id} className="flex gap-2 items-baseline">
                    <span className="font-semibold shrink-0 text-red-600">−{fmt(item.amount)}</span>
                    <span className="text-slate-700">Бонус</span>
                    {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                  </div>
                ))}
              </div>
            )}
            {advanceItems.length > 0 && (
              <div className={`space-y-1.5 ${(items.length > 0 || bonusItems.length > 0) ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {advanceItems.map((item) => {
                  const recipient = employees.find((e) => e.id === item.employeeId);
                  return (
                    <div key={item.id} className="flex gap-2 items-baseline">
                      <span className="font-semibold shrink-0 text-red-600">−{fmt(item.amount)}</span>
                      <span className="text-slate-700">Зарплата</span>
                      <span className="text-slate-400">→ {recipient?.name ?? 'сотрудник не указан'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {surchargeItems.length > 0 && (
              <div className={`space-y-1.5 ${(items.length > 0 || bonusItems.length > 0 || advanceItems.length > 0) ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {surchargeItems.map((item) => {
                  const recipient = employees.find((e) => e.id === item.employeeId);
                  return (
                    <div key={item.id} className="flex gap-2 items-baseline">
                      <span className="font-semibold shrink-0 text-red-600">−{fmt(item.amount)}</span>
                      <span className="text-slate-700">Доплата</span>
                      <span className="text-slate-400">→ {recipient?.name ?? 'сотрудник не указан'}</span>
                      {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {tooltipEntry.generalComment && (
              <div className={`text-slate-400 italic ${(items.length > 0 || bonusItems.length > 0 || advanceItems.length > 0 || surchargeItems.length > 0) ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {tooltipEntry.generalComment}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
