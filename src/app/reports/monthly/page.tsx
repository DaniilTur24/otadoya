'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface Pharmacy { id: number; name: string }
type DataMap = Record<number, Record<string, number>>;

type RowSource = 'db' | 'empty' | 'calc';
interface ReportRow {
  key: string; label: string; source: RowSource;
  bold?: boolean; section?: boolean; indent?: boolean; decimals?: number;
}

const EXPENSE_KEYS = [
  'goodsExpenses','pharmaBonus','pharmaSalary','officeSalary','association','charity',
  'accountingServices','stationery','utilities','deferredTax','vat','security',
  'otherExpenses','householdExpenses','advertising','repairs','rentExpenses',
  'fixedAssets','standardKaspibot','daribar','communications','equipment',
  'transport','cleaning','bankServices','terminalRent','procedureRent',
];

const ROWS: ReportRow[] = [
  { key: '_rev',              label: 'ВЫРУЧКА',                                          section: true, source: 'calc' },
  { key: 'retailRevenue',     label: 'ВЫРУЧКА розн в аптеке',                           source: 'db',    bold: true },
  { key: 'kaspiRevenue',      label: 'Выручка Каспи',                                   source: 'empty', indent: true },
  { key: 'wholesaleRevenue',  label: 'ВЫРУЧКА опт',                                     source: 'calc',  bold: true },
  { key: 'coefficient',       label: 'коэффициент',                                     source: 'db',    decimals: 2 },
  { key: 'avgDailyRevenue',   label: 'Среднедневная розн выручка',                      source: 'empty' },
  { key: 'terminalRent',      label: 'Аренда терминал',                                 source: 'db' },
  { key: 'procedureRent',     label: 'Процедурная аренда',                              source: 'db' },
  { key: 'legalEntityProfit', label: 'Прибыль по юрлицам',                             source: 'empty' },
  { key: '_stock',            label: 'ОСТАТКИ',                                         section: true, source: 'calc' },
  { key: 'stockRetail',       label: 'Остаток товара на конец месяца по розн ценам',    source: 'empty' },
  { key: 'stockWholesale',    label: 'Остаток товара на конец месяца по оптовым ценам', source: 'empty' },
  { key: 'consignment',       label: 'Консигнация',                                     source: 'empty' },
  { key: 'consignmentOverdue',label: 'из них просрочка',                                source: 'empty', indent: true },
  { key: '_exp',              label: 'РАСХОДЫ',                                         section: true, source: 'calc' },
  { key: 'goodsExpenses',     label: 'Расходы на товар',                                source: 'empty' },
  { key: 'pharmaBonus',       label: 'Бонусы фарм и зав',                              source: 'empty' },
  { key: 'pharmaSalary',      label: 'Оклады фарм и зав',                              source: 'empty' },
  { key: 'officeSalary',      label: 'Зарплата офиса',                                  source: 'empty' },
  { key: 'association',       label: 'Ассоциация',                                      source: 'empty' },
  { key: 'charity',           label: 'Благотворительность',                             source: 'empty' },
  { key: 'accountingServices',label: 'Бух.услуги',                                      source: 'empty' },
  { key: 'stationery',        label: 'Канцелярские и офисные принадлежности',           source: 'empty' },
  { key: 'utilities',         label: 'Коммунальные расходы',                            source: 'empty' },
  { key: 'deferredTax',       label: 'Налоги отложенные',                               source: 'empty' },
  { key: 'vat',               label: 'НДС 5% с наценкой 20%',                          source: 'empty' },
  { key: 'security',          label: 'Охрана',                                          source: 'empty' },
  { key: 'otherExpenses',     label: 'Прочие расходы',                                  source: 'db' },
  { key: 'householdExpenses', label: 'Расходы на хознужды',                             source: 'empty' },
  { key: 'advertising',       label: 'Расходы на рекламу',                              source: 'empty' },
  { key: 'repairs',           label: 'Расходы на ремонт',                               source: 'empty' },
  { key: 'rentExpenses',      label: 'Расходы по арендной плате',                       source: 'db' },
  { key: 'fixedAssets',       label: 'Расходы по обслуг.ФА',                           source: 'empty' },
  { key: 'standardKaspibot',  label: 'Стандарт Ни Каспибот',                           source: 'empty' },
  { key: 'daribar',           label: 'Расходы Дарибар',                                 source: 'empty' },
  { key: 'communications',    label: 'Расходы по связи, интернет, ОФД, Webkassa',      source: 'empty' },
  { key: 'equipment',         label: 'Техника, мебель',                                 source: 'empty' },
  { key: 'transport',         label: 'Транспортные услуги на тер.РК',                  source: 'empty' },
  { key: 'cleaning',          label: 'Уборка территории',                               source: 'empty' },
  { key: 'bankServices',      label: 'Услуги банка без НДС',                            source: 'db' },
  { key: 'totalExpenses',     label: 'ИТОГО РАСХОДЫ',                                  source: 'calc', bold: true },
  { key: 'netIncome',         label: 'Чистый доход',                                    source: 'calc', bold: true },
  { key: 'divideBy2',         label: 'Разделить на 2',                                  source: 'empty' },
  { key: 'directorShare',     label: 'руководителя',                                    source: 'empty' },
];

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

function fmtN(n: number, decimals = 0): string {
  if (!n) return '';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ─── Компонент редактируемой ячейки ────────────────────────────────────────

function Cell({
  pharmacyId, fieldKey, systemValue, overrideValue,
  onSave, onReset, decimals = 0,
}: {
  pharmacyId: number; fieldKey: string;
  systemValue: number; overrideValue: number | undefined;
  onSave: (pharmacyId: number, key: string, val: number) => Promise<void>;
  onReset: (pharmacyId: number, key: string) => Promise<void>;
  decimals?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isOverridden = overrideValue !== undefined;
  const displayValue = isOverridden ? overrideValue : systemValue;

  function startEdit() {
    setInputVal(displayValue ? String(displayValue) : '');
    setEditing(true);
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const num = parseFloat(inputVal.replace(/\s/g, '').replace(',', '.')) || 0;
    await onSave(pharmacyId, fieldKey, num);
    setEditing(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  }

  if (editing) {
    return (
      <td className="px-1 py-0.5 bg-blue-50">
        <input
          ref={inputRef}
          type="text"
          className="w-full text-right text-xs border border-blue-400 rounded px-1 py-0.5 outline-none bg-white"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
        />
      </td>
    );
  }

  return (
    <td
      className={`px-2 py-1.5 text-right tabular-nums group cursor-pointer select-none ${
        isOverridden
          ? 'bg-yellow-50'
          : displayValue === 0
          ? 'text-gray-200'
          : ''
      } ${
        displayValue < 0 ? 'text-red-600 font-medium' : ''
      }`}
      onClick={startEdit}
      title={isOverridden ? `Изменено вручную. Системное значение: ${fmtN(systemValue, decimals) || '0'}` : 'Нажмите для редактирования'}
    >
      <div className="flex items-center justify-end gap-1">
        {isOverridden && (
          <button
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity text-xs leading-none"
            title="Сбросить к системному значению"
            onMouseDown={(e) => { e.stopPropagation(); onReset(pharmacyId, fieldKey); }}
          >
            ↩
          </button>
        )}
        <span className={isOverridden ? 'text-amber-700 font-medium' : ''}>
          {displayValue === 0 ? '—' : fmtN(displayValue, decimals)}
        </span>
        {isOverridden && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Изменено вручную" />
        )}
      </div>
    </td>
  );
}

// ─── Главная страница ───────────────────────────────────────────────────────

export default function MonthlyReportPage() {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [systemData, setSystemData] = useState<DataMap>({});
  // overrideMap: "pharmacyId:fieldKey" → number
  const [overrideMap, setOverrideMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`);
    const json = await res.json();
    setPharmacies(json.pharmacies ?? []);
    setSystemData(json.systemData ?? {});
    setOverrideMap(json.overrideMap ?? {});
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  function getSystemValue(pharmacyId: number, key: string): number {
    return systemData[pharmacyId]?.[key] ?? 0;
  }

  function getOverride(pharmacyId: number, key: string): number | undefined {
    const k = `${pharmacyId}:${key}`;
    return overrideMap[k] !== undefined ? overrideMap[k] : undefined;
  }

  function getCurrentValue(pharmacyId: number, key: string): number {
    const ov = getOverride(pharmacyId, key);
    if (ov !== undefined) return ov;
    if (key === 'wholesaleRevenue') {
      const coeff = getCurrentValue(pharmacyId, 'coefficient');
      if (coeff > 0) return Math.round(getCurrentValue(pharmacyId, 'retailRevenue') / coeff);
      return 0;
    }
    if (key === 'totalExpenses') {
      return EXPENSE_KEYS.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0);
    }
    if (key === 'netIncome') {
      return getCurrentValue(pharmacyId, 'retailRevenue') - getCurrentValue(pharmacyId, 'totalExpenses');
    }
    return getSystemValue(pharmacyId, key);
  }

  function rowTotal(key: string): number {
    if (key.startsWith('_')) return 0;
    return pharmacies.reduce((s, p) => s + getCurrentValue(p.id, key), 0);
  }

  async function handleSave(pharmacyId: number, key: string, value: number) {
    setSaving(true);
    const k = `${pharmacyId}:${key}`;
    setOverrideMap((m) => ({ ...m, [k]: value }));
    await fetch(`/api/reports/monthly`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, pharmacyId, fieldKey: key, value }),
    });
    setSaving(false);
  }

  async function handleReset(pharmacyId: number, key: string) {
    setSaving(true);
    const k = `${pharmacyId}:${key}`;
    setOverrideMap((m) => { const n = { ...m }; delete n[k]; return n; });
    await fetch(`/api/reports/monthly`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, pharmacyId, fieldKey: key, value: null }),
    });
    setSaving(false);
  }

  // Сброс ВСЕХ изменений за этот месяц
  async function resetAll() {
    if (!confirm('Сбросить все ручные изменения за этот месяц?')) return;
    setSaving(true);
    const allKeys = Object.keys(overrideMap);
    await Promise.all(
      allKeys.map((k) => {
        const [pId, ...rest] = k.split(':');
        return fetch(`/api/reports/monthly`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, month, pharmacyId: Number(pId), fieldKey: rest.join(':'), value: null }),
        });
      })
    );
    setOverrideMap({});
    setSaving(false);
  }

  const overrideCount = Object.keys(overrideMap).length;

  return (
    <div>
      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Закрытие месяца</h1>
        <Link href="/reports" className="text-sm text-gray-400 hover:text-gray-600">← Обычные отчёты</Link>
        {saving && <span className="text-xs text-blue-500">Сохранение...</span>}
      </div>
      <p className="text-gray-500 text-sm mb-5">
        Нажмите на любую ячейку чтобы изменить значение. Кнопка <strong>↩</strong> сбрасывает ячейку к системному значению.
      </p>

      {/* Фильтр + действия */}
      <div className="card p-4 mb-5 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label">Месяц</label>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Год</label>
          <input type="number" className="input w-24" value={year} min={2020} max={2099}
            onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <div className="pb-0.5 text-sm text-gray-600 font-medium">
          {MONTH_NAMES[month - 1]} {year}
        </div>
        {overrideCount > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-amber-600">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
              {overrideCount} {overrideCount === 1 ? 'ячейка изменена' : 'ячеек изменено'} вручную
            </span>
            <button className="btn-secondary text-xs" onClick={resetAll} disabled={saving}>
              Сбросить все изменения
            </button>
          </div>
        )}
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap gap-4 text-xs mb-3 text-gray-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />Данные из системы</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-gray-200 mr-1" />Пока пусто — нажмите чтобы ввести</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />Вычисляется автоматически</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />Изменено вручную</span>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="px-3 py-2 text-left font-medium sticky left-0 bg-gray-800 z-10 min-w-[220px]">
                    Показатель
                  </th>
                  {pharmacies.map((p) => (
                    <th key={p.id} className="px-2 py-2 text-right font-medium whitespace-nowrap min-w-[90px]">
                      {p.name.replace('Аптека ', '').replace(' — ', ' ')}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-bold bg-gray-700 min-w-[100px]">ИТОГО</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  if (row.section) {
                    return (
                      <tr key={row.key} className="bg-gray-100">
                        <td colSpan={pharmacies.length + 2}
                          className="px-3 py-1.5 font-bold text-gray-600 uppercase tracking-wide text-xs sticky left-0 bg-gray-100">
                          {row.label}
                        </td>
                      </tr>
                    );
                  }

                  const total = rowTotal(row.key);
                  const isCalc = row.source === 'calc';

                  return (
                    <tr key={row.key} className={`border-b border-gray-100 ${
                      row.key === 'totalExpenses' || row.key === 'netIncome' ? 'bg-gray-50' : ''
                    }`}>
                      {/* Название */}
                      <td className={`px-3 py-1.5 sticky left-0 bg-white border-r border-gray-200 ${
                        row.key === 'totalExpenses' || row.key === 'netIncome' ? 'bg-gray-50' : ''
                      } ${row.bold ? 'font-semibold text-gray-800' : 'text-gray-700'} ${row.indent ? 'pl-6' : ''}`}>
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                            row.source === 'db' ? 'bg-blue-400' :
                            isCalc ? 'bg-green-400' : 'bg-gray-200'
                          }`} />
                          {row.label}
                        </div>
                      </td>

                      {/* Ячейки по аптекам */}
                      {pharmacies.map((p) => {
                        if (isCalc) {
                          const sysVal = getCurrentValue(p.id, row.key);
                          const ov = getOverride(p.id, row.key);
                          return (
                            <Cell
                              key={p.id}
                              pharmacyId={p.id}
                              fieldKey={row.key}
                              systemValue={sysVal}
                              overrideValue={ov}
                              onSave={handleSave}
                              onReset={handleReset}
                              decimals={row.decimals}
                            />
                          );
                        }
                        return (
                          <Cell
                            key={p.id}
                            pharmacyId={p.id}
                            fieldKey={row.key}
                            systemValue={getSystemValue(p.id, row.key)}
                            overrideValue={getOverride(p.id, row.key)}
                            onSave={handleSave}
                            onReset={handleReset}
                            decimals={row.decimals}
                          />
                        );
                      })}

                      {/* ИТОГО */}
                      <td className={`px-2 py-1.5 text-right tabular-nums font-semibold border-l border-gray-200 ${
                        total === 0 ? 'text-gray-300' :
                        total < 0  ? 'text-red-600' :
                        row.key === 'retailRevenue' || row.key === 'netIncome' ? 'text-blue-700' :
                        row.key === 'totalExpenses' ? 'text-red-700' : 'text-gray-800'
                      }`}>
                        {total === 0 ? '—' : fmtN(total, row.decimals)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
