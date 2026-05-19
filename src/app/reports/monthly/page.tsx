'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { MONTHLY_REPORT_ROWS, MonthlyReportRow, RowType } from '@/lib/monthly-report-fields';

interface Pharmacy { id: number; name: string }
type DataMap = Record<number, Record<string, number>>;

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

function fmtN(n: number, decimals = 0): string {
  if (!n) return '';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ─── Редактируемая ячейка ──────────────────────────────────────────────────

function Cell({
  pharmacyId, fieldKey, systemValue, overrideValue,
  onSave, onReset, decimals = 0, rowType,
}: {
  pharmacyId: number; fieldKey: string;
  systemValue: number; overrideValue: number | undefined;
  onSave: (pharmacyId: number, key: string, val: number) => Promise<void>;
  onReset: (pharmacyId: number, key: string) => Promise<void>;
  decimals?: number;
  rowType?: RowType;
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

  let valueColor = '';
  if (isOverridden) {
    valueColor = 'text-amber-700 font-medium';
  } else if (displayValue !== 0) {
    if (rowType === 'income') valueColor = 'text-green-700';
    else if (rowType === 'expense') valueColor = 'text-red-600';
  }

  return (
    <td
      className={`px-2 py-1.5 text-right tabular-nums group cursor-pointer select-none ${
        isOverridden ? 'bg-yellow-50' : displayValue === 0 ? 'text-gray-200' : ''
      }`}
      onClick={startEdit}
      title={isOverridden ? `Изменено вручную. Системное: ${fmtN(systemValue, decimals) || '0'}` : 'Нажмите для редактирования'}
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
        <span className={valueColor}>
          {displayValue === 0 ? '—' : fmtN(displayValue, decimals)}
        </span>
        {isOverridden && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}
      </div>
    </td>
  );
}

// ─── Главная страница ──────────────────────────────────────────────────────

export default function MonthlyReportPage() {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [systemData, setSystemData] = useState<DataMap>({});
  const [totalOnlyData, setTotalOnlyData] = useState<Record<string, number>>({});
  const [overrideMap, setOverrideMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Конфиги типов полей из БД: fieldKey → rowType
  const [fieldConfigs, setFieldConfigs] = useState<Record<string, string>>({});
  const [configMode, setConfigMode] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Строки с применёнными типами из БД (перекрывают defaults)
  const effectiveRows = useMemo<MonthlyReportRow[]>(
    () =>
      MONTHLY_REPORT_ROWS.map((row) => ({
        ...row,
        rowType: (fieldConfigs[row.key] as RowType | undefined) ?? row.rowType,
      })),
    [fieldConfigs]
  );

  useEffect(() => {
    fetch('/api/monthly-field-configs')
      .then((r) => r.json())
      .then((configs: { fieldKey: string; rowType: string }[]) => {
        const map: Record<string, string> = {};
        for (const c of configs) map[c.fieldKey] = c.rowType;
        setFieldConfigs(map);
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`);
    const json = await res.json();
    setPharmacies(json.pharmacies ?? []);
    setSystemData(json.systemData ?? {});
    setTotalOnlyData(json.totalOnlyData ?? {});
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
      const expKeys = effectiveRows.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
      return expKeys.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0);
    }
    if (key === 'netIncome') {
      const incKeys = effectiveRows.filter((r) => r.rowType === 'income' && !r.section).map((r) => r.key);
      const expKeys = effectiveRows.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
      return (
        incKeys.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0) -
        expKeys.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0)
      );
    }
    return getSystemValue(pharmacyId, key);
  }

  function rowTotal(key: string): number {
    if (key.startsWith('_')) return 0;
    const pharmacyTotal = pharmacies.reduce((s, p) => s + getCurrentValue(p.id, key), 0);

    if (key === 'totalExpenses') {
      const expKeys = effectiveRows.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
      const totalOnlyExp = expKeys.reduce((s, k) => s + (totalOnlyData[k] ?? 0), 0);
      return pharmacyTotal + totalOnlyExp;
    }
    if (key === 'netIncome') {
      const incKeys = effectiveRows.filter((r) => r.rowType === 'income' && !r.section).map((r) => r.key);
      const expKeys = effectiveRows.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
      const adj =
        incKeys.reduce((s, k) => s + (totalOnlyData[k] ?? 0), 0) -
        expKeys.reduce((s, k) => s + (totalOnlyData[k] ?? 0), 0);
      return pharmacyTotal + adj;
    }
    return pharmacyTotal + (totalOnlyData[key] ?? 0);
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

  async function resetAll() {
    if (!confirm('Сбросить все ручные изменения за этот месяц?')) return;
    setSaving(true);
    await Promise.all(
      Object.keys(overrideMap).map((k) => {
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

  async function saveFieldConfig(fieldKey: string, rowType: string) {
    setSavingConfig(true);
    setFieldConfigs((prev) => ({ ...prev, [fieldKey]: rowType }));
    await fetch('/api/monthly-field-configs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldKey, rowType }),
    });
    setSavingConfig(false);
  }

  const overrideCount = Object.keys(overrideMap).length;
  const UNCONFIGURABLE = new Set(['totalExpenses', 'netIncome', 'divideBy2', 'directorShare',
    'wholesaleRevenue', 'coefficient', 'avgDailyRevenue']);

  return (
    <div>
      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Закрытие месяца</h1>
        <Link href="/reports" className="text-sm text-gray-400 hover:text-gray-600">← Обычные отчёты</Link>
        {saving && <span className="text-xs text-blue-500">Сохранение...</span>}
        {savingConfig && <span className="text-xs text-purple-500">Сохранение типа...</span>}
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
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <button
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              configMode
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
            onClick={() => setConfigMode((v) => !v)}
          >
            {configMode ? '✓ Готово' : 'Настроить типы полей'}
          </button>
          {overrideCount > 0 && (
            <>
              <span className="text-xs text-amber-600">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
                {overrideCount} {overrideCount === 1 ? 'ячейка изменена' : 'ячеек изменено'} вручную
              </span>
              <button className="btn-secondary text-xs" onClick={resetAll} disabled={saving}>
                Сбросить все
              </button>
            </>
          )}
        </div>
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap gap-4 text-xs mb-3 text-gray-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />Данные из системы</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-gray-200 mr-1" />Пусто — нажмите чтобы ввести</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1" />Вычисляется автоматически</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />Изменено вручную</span>
        {configMode && (
          <span className="text-purple-600 font-medium">
            Режим настройки: укажите тип каждой строки
          </span>
        )}
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
                    {configMode && <span className="ml-2 text-gray-400 font-normal">тип</span>}
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
                {effectiveRows.map((row) => {
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
                  const isSummaryRow = row.key === 'totalExpenses' || row.key === 'netIncome';
                  const canConfigure = configMode && !UNCONFIGURABLE.has(row.key);

                  // Цвет колонки ИТОГО
                  let totalCellClass = 'text-gray-800';
                  if (total === 0) {
                    totalCellClass = 'text-gray-300';
                  } else if (row.rowType === 'income') {
                    totalCellClass = 'text-green-700 font-semibold';
                  } else if (row.rowType === 'expense') {
                    totalCellClass = 'text-red-600 font-semibold';
                  } else if (row.key === 'totalExpenses') {
                    totalCellClass = 'text-red-700 font-bold';
                  } else if (row.key === 'netIncome') {
                    totalCellClass = total >= 0 ? 'text-green-700 font-bold' : 'text-red-600 font-bold';
                  }

                  return (
                    <tr key={row.key} className={`border-b border-gray-100 ${isSummaryRow ? 'bg-gray-50' : ''}`}>
                      {/* Название + настройка типа */}
                      <td className={`px-3 py-1.5 sticky left-0 bg-white border-r border-gray-200 ${
                        isSummaryRow ? 'bg-gray-50' : ''
                      } ${row.bold ? 'font-semibold text-gray-800' : 'text-gray-700'} ${row.indent ? 'pl-6' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                            row.source === 'db' ? 'bg-blue-400' :
                            isCalc ? 'bg-green-400' : 'bg-gray-200'
                          }`} />
                          <span className="flex-1">{row.label}</span>
                          {canConfigure && (
                            <span className="flex gap-0.5 shrink-0">
                              {(['income', 'neutral', 'expense'] as const).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => saveFieldConfig(row.key, t)}
                                  title={t === 'income' ? 'Доход' : t === 'expense' ? 'Расход' : 'Нейтрально'}
                                  className={`text-[10px] px-1.5 py-0.5 rounded leading-none transition-colors ${
                                    row.rowType === t
                                      ? t === 'income' ? 'bg-green-600 text-white'
                                        : t === 'expense' ? 'bg-red-600 text-white'
                                        : 'bg-gray-500 text-white'
                                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                  }`}
                                >
                                  {t === 'income' ? 'Д' : t === 'expense' ? 'Р' : '—'}
                                </button>
                              ))}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Ячейки по аптекам */}
                      {pharmacies.map((p) => {
                        const sysVal = isCalc ? getCurrentValue(p.id, row.key) : getSystemValue(p.id, row.key);
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
                            rowType={row.rowType}
                          />
                        );
                      })}

                      {/* ИТОГО */}
                      <td className={`px-2 py-1.5 text-right tabular-nums border-l border-gray-200 ${totalCellClass}`}>
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
