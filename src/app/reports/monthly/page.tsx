'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { MONTHLY_REPORT_ROWS, MonthlyReportRow, RowType } from '@/lib/monthly-report-fields';

interface Pharmacy { id: number; name: string }
type DataMap = Record<number, Record<string, number>>;
type Direction = 'up' | 'down' | 'left' | 'right';

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
  onSave, onReset, decimals = 0, rowType, locked,
  isSelected, onSelect, onNavigate, cellRef,
}: {
  pharmacyId: number; fieldKey: string;
  systemValue: number; overrideValue: number | undefined;
  onSave: (pharmacyId: number, key: string, val: number) => Promise<void>;
  onReset: (pharmacyId: number, key: string) => Promise<void>;
  decimals?: number;
  rowType?: RowType;
  locked?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onNavigate: (dir: Direction) => void;
  cellRef: (el: HTMLTableCellElement | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tdRef = useRef<HTMLTableCellElement | null>(null);
  const isOverridden = overrideValue !== undefined;
  const displayValue = isOverridden ? overrideValue : systemValue;

  function startEdit(initial?: string) {
    setInputVal(initial !== undefined ? initial : (displayValue ? String(displayValue) : ''));
    setEditing(true);
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (isSelected && !editing) tdRef.current?.focus();
  }, [isSelected, editing]);

  async function commit(moveAfter: Direction | null) {
    const num = parseFloat(inputVal.replace(/\s/g, '').replace(',', '.')) || 0;
    if (num !== displayValue) {
      await onSave(pharmacyId, fieldKey, num);
    }
    setEditing(false);
    if (moveAfter) onNavigate(moveAfter);
  }

  function handleInputKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'left' : 'right'); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  }

  function handleCellKey(e: React.KeyboardEvent) {
    if (editing || locked) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); onNavigate('up'); break;
      case 'ArrowDown': e.preventDefault(); onNavigate('down'); break;
      case 'ArrowLeft': e.preventDefault(); onNavigate('left'); break;
      case 'ArrowRight': e.preventDefault(); onNavigate('right'); break;
      case 'Tab': e.preventDefault(); onNavigate(e.shiftKey ? 'left' : 'right'); break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEdit();
        break;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        startEdit('');
        break;
      default:
        if (e.key.length === 1 && /[0-9.,-]/.test(e.key)) {
          e.preventDefault();
          startEdit(e.key);
        }
    }
  }

  if (locked) {
    const lockedColor = displayValue === 0 ? 'text-slate-200' : rowType === 'income' ? 'text-green-700' : rowType === 'expense' ? 'text-red-600' : '';
    return (
      <td className="px-2 py-1.5 text-right tabular-nums">
        <span className={lockedColor}>{displayValue === 0 ? '—' : fmtN(displayValue, decimals)}</span>
      </td>
    );
  }

  if (editing) {
    return (
      <td className="px-1 py-0.5 bg-slate-100" ref={cellRef}>
        <input
          ref={inputRef}
          type="text"
          className="w-full text-right text-xs border border-slate-400 rounded px-1 py-0.5 outline-none bg-white"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={() => commit(null)}
          onKeyDown={handleInputKey}
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
      ref={(el) => { tdRef.current = el; cellRef(el); }}
      tabIndex={isSelected ? 0 : -1}
      className={`px-2 py-1.5 text-right tabular-nums group cursor-pointer select-none outline-none ${
        isOverridden ? 'bg-yellow-50' : displayValue === 0 ? 'text-slate-200' : ''
      } ${isSelected ? 'ring-2 ring-inset ring-blue-500' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => startEdit()}
      onKeyDown={handleCellKey}
      title={isOverridden ? `Изменено вручную. Системное: ${fmtN(systemValue, decimals) || '0'}` : 'Кликните, чтобы выбрать ячейку. Enter или дважды клик — редактировать.'}
    >
      <div className="flex items-center justify-end gap-1">
        {isOverridden && (
          <button
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity text-xs leading-none"
            title="Сбросить к системному значению"
            onMouseDown={(e) => { e.stopPropagation(); onReset(pharmacyId, fieldKey); }}
          >
            ↩
          </button>
        )}
        <span className={valueColor}>
          {displayValue === 0 ? '—' : fmtN(displayValue, decimals)}
        </span>
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
  const [overrideMap, setOverrideMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [selected, setSelected] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  // Сотрудники, у которых не заполнен производственный календарь — их пятидневная/табельная
  // часть оклада сейчас считается как 0 вместо реальной суммы. Показываем заранее, до клика
  // «Закрыть месяц», где сервер это же самое отклонит с 400.
  const [calendarMissingNames, setCalendarMissingNames] = useState<string[]>([]);
  // Симметричный случай для заведующей на фиксированной ставке (manager_trading с
  // fiveDayViaAttendance) — та же тихая нулевая зарплата, но лечится не календарём, а ставкой
  // на /users, поэтому отдельный список и отдельная подсказка.
  const [shiftRateMissingNames, setShiftRateMissingNames] = useState<string[]>([]);
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  const editableRows = MONTHLY_REPORT_ROWS.filter((r) => !r.section);
  const rowIndexMap = new Map(editableRows.map((r, i) => [r.key, i]));

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`);
    const json = await res.json();
    setPharmacies(json.pharmacies ?? []);
    setIsClosed(json.isClosed ?? false);
    setClosedAt(json.closedAt ?? null);
    setSelected(null);
    if (json.isClosed && json.snapshotData) {
      setSystemData(json.snapshotData);
      setOverrideMap({});
    } else {
      setSystemData(json.systemData ?? {});
      setOverrideMap(json.overrideMap ?? {});
    }
    setLoading(false);

    // Закрытый месяц уже заморожен снимком — календарь/ставка на его цифры больше не влияют,
    // проверять нечего.
    if (!json.isClosed) {
      const salaryRes = await fetch(`/api/employees/salary-summary?year=${year}&month=${month}`);
      const salaryJson = await salaryRes.json();
      const employees: { employeeName: string; calendarMissing?: boolean; shiftRateMissing?: boolean }[] = salaryJson.employees ?? [];
      setCalendarMissingNames([...new Set(employees.filter((e) => e.calendarMissing).map((e) => e.employeeName))]);
      setShiftRateMissingNames([...new Set(employees.filter((e) => e.shiftRateMissing).map((e) => e.employeeName))]);
    } else {
      setCalendarMissingNames([]);
      setShiftRateMissingNames([]);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    const key = `${selected.rowIdx}-${selected.colIdx}`;
    cellRefs.current.get(key)?.focus();
  }, [selected]);

  function registerCellRef(rowIdx: number, colIdx: number) {
    return (el: HTMLTableCellElement | null) => {
      const key = `${rowIdx}-${colIdx}`;
      if (el) cellRefs.current.set(key, el);
      else cellRefs.current.delete(key);
    };
  }

  function navigate(rowIdx: number, colIdx: number, dir: Direction) {
    let r = rowIdx;
    let c = colIdx;
    switch (dir) {
      case 'up': r = Math.max(0, r - 1); break;
      case 'down': r = Math.min(editableRows.length - 1, r + 1); break;
      case 'left':
        if (c === 0) { if (r > 0) { r -= 1; c = pharmacies.length - 1; } }
        else c -= 1;
        break;
      case 'right':
        if (c === pharmacies.length - 1) { if (r < editableRows.length - 1) { r += 1; c = 0; } }
        else c += 1;
        break;
    }
    setSelected({ rowIdx: r, colIdx: c });
  }

  function getSystemValue(pharmacyId: number, key: string): number {
    return systemData[pharmacyId]?.[key] ?? 0;
  }

  function getOverride(pharmacyId: number, key: string): number | undefined {
    const k = `${pharmacyId}:${key}`;
    return overrideMap[k] !== undefined ? overrideMap[k] : undefined;
  }

  function getCurrentValue(pharmacyId: number, key: string): number {
    if (isClosed) return systemData[pharmacyId]?.[key] ?? 0;
    const ov = getOverride(pharmacyId, key);
    if (ov !== undefined) return ov;
    if (key === 'wholesaleRevenue') {
      const coeff = getCurrentValue(pharmacyId, 'coefficient');
      if (coeff > 0) return Math.round(getCurrentValue(pharmacyId, 'retailRevenue') / coeff);
      return 0;
    }
    if (key === 'totalExpenses') {
      const expKeys = MONTHLY_REPORT_ROWS.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
      return expKeys.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0);
    }
    if (key === 'netIncome') {
      const incKeys = MONTHLY_REPORT_ROWS.filter((r) => r.rowType === 'income' && !r.section).map((r) => r.key);
      const expKeys = MONTHLY_REPORT_ROWS.filter((r) => r.rowType === 'expense' && !r.section).map((r) => r.key);
      return (
        incKeys.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0) -
        expKeys.reduce((s, k) => s + getCurrentValue(pharmacyId, k), 0)
      );
    }
    return getSystemValue(pharmacyId, key);
  }

  async function closeMonth() {
    if (!confirm(`Закрыть ${MONTH_NAMES[month - 1]} ${year}? После закрытия данные нельзя будет изменить.`)) return;
    setClosing(true);
    const snapshot: Record<string, Record<string, number>> = {};
    for (const p of pharmacies) {
      snapshot[String(p.id)] = {};
      for (const row of MONTHLY_REPORT_ROWS) {
        if (row.section) continue;
        snapshot[String(p.id)][row.key] = getCurrentValue(p.id, row.key);
      }
    }
    const res = await fetch('/api/months/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, snapshot }),
    });
    setClosing(false);
    if (!res.ok) {
      // Раньше ответ вообще не проверялся — сервер мог отклонить закрытие (например,
      // из-за незаполненного календаря), а бухгалтер не видел никакой причины.
      const json = await res.json().catch(() => ({}));
      alert(json.error || 'Не удалось закрыть месяц');
      return;
    }
    await load();
  }

  async function reopenMonth() {
    if (!confirm(`Открыть ${MONTH_NAMES[month - 1]} ${year} снова? Снимок данных будет удалён.`)) return;
    setClosing(true);
    await fetch('/api/months/close', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month }),
    });
    setClosing(false);
    await load();
  }

  function rowTotal(key: string): number {
    if (key.startsWith('_')) return 0;
    const pharmacyTotal = pharmacies.reduce((s, p) => s + getCurrentValue(p.id, key), 0);

    return pharmacyTotal;
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

  function exportCsv() {
    const header = ['Показатель', ...pharmacies.map((p) => p.name), 'ИТОГО'];
    const lines: string[][] = [header];

    for (const row of MONTHLY_REPORT_ROWS) {
      if (row.section) {
        lines.push([row.label]);
        continue;
      }
      const values = pharmacies.map((p) => getCurrentValue(p.id, row.key).toFixed(row.decimals ?? 0));
      lines.push([row.label, ...values, rowTotal(row.key).toFixed(row.decimals ?? 0)]);
    }

    const csv = lines
      .map((cols) => cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    // BOM — иначе Excel открывает кириллицу в CSV как кракозябры
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `otchet_${year}_${String(month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const overrideCount = Object.keys(overrideMap).length;

  return (
    <div>
      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-900">Закрытие месяца</h1>
        {saving && <span className="text-xs text-slate-700 inline-flex items-center gap-1.5"><span className="spinner" />Сохранение...</span>}
      </div>
      <p className="text-slate-500 text-sm mb-5">
        Кликните на ячейку, чтобы выбрать её — стрелки и Tab перемещают выбор. Enter, F2, двойной клик или начало ввода числа открывают редактирование;
        Enter сохраняет и переходит вниз, Tab — вправо, Esc — отмена. Кнопка <strong>↩</strong> сбрасывает ячейку к системному значению.
      </p>

      {/* Фильтр + действия */}
      <div className="card p-3 mb-4 flex flex-wrap gap-3 items-end">
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
        <div className="pb-0.5 text-sm text-slate-600 font-medium">
          {MONTH_NAMES[month - 1]} {year}
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <button
            className="btn-secondary text-xs"
            onClick={exportCsv}
            disabled={loading || pharmacies.length === 0}
          >
            Скачать CSV
          </button>
          {!isClosed && overrideCount > 0 && (
            <>
              <span className="text-xs text-amber-600">
                {overrideCount} {overrideCount === 1 ? 'ячейка изменена' : 'ячеек изменено'} вручную
              </span>
              <button className="btn-secondary text-xs" onClick={resetAll} disabled={saving}>
                Сбросить все
              </button>
            </>
          )}
          {isClosed ? (
            <button
              className="text-xs px-3 py-1.5 rounded border bg-white text-slate-600 border-slate-300 hover:border-slate-400 inline-flex items-center gap-1.5"
              onClick={reopenMonth}
              disabled={closing}
            >
              {closing && <span className="spinner" />}{closing ? 'Открытие...' : 'Открыть месяц'}
            </button>
          ) : (
            <button
              className="text-xs px-3 py-1.5 rounded border bg-green-600 text-white border-green-600 hover:bg-green-700 inline-flex items-center gap-1.5"
              onClick={closeMonth}
              disabled={closing || loading}
            >
              {closing && <span className="spinner" />}{closing ? 'Закрытие...' : 'Закрыть месяц'}
            </button>
          )}
        </div>
      </div>

      {isClosed && closedAt && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded flex items-center gap-3">
          <span className="text-green-700 text-sm font-medium">
            Месяц закрыт {new Date(closedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <span className="text-green-600 text-xs">Данные зафиксированы и недоступны для изменения</span>
        </div>
      )}

      {!isClosed && calendarMissingNames.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded">
          <span className="text-amber-700 text-sm font-medium">
            Не заполнен производственный календарь за {MONTH_NAMES[month - 1]} {year}
          </span>
          <span className="text-amber-600 text-xs block mt-0.5">
            Пятидневная/табельная часть оклада сейчас считается как 0 для: {calendarMissingNames.join(', ')}.
            Закрыть месяц не получится, пока календарь не заполнен —{' '}
            <Link href="/settings/working-calendar" className="underline">заполнить сейчас</Link>.
          </span>
        </div>
      )}

      {!isClosed && shiftRateMissingNames.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded">
          <span className="text-amber-700 text-sm font-medium">
            Не заполнена ставка за смену за {MONTH_NAMES[month - 1]} {year}
          </span>
          <span className="text-amber-600 text-xs block mt-0.5">
            Пятидневная часть зарплаты сейчас считается как 0 для: {shiftRateMissingNames.join(', ')}.
            Закрыть месяц не получится, пока ставка не заполнена —{' '}
            <Link href="/users" className="underline">заполнить сейчас</Link>.
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-200 text-slate-800">
                  <th className="px-3 py-1.5 text-left font-semibold sticky left-0 bg-slate-200 z-10 min-w-[220px] border-b border-r border-slate-300">
                    Показатель
                  </th>
                  {pharmacies.map((p) => (
                    <th key={p.id} className="px-2 py-1.5 text-right font-semibold whitespace-nowrap min-w-[90px] border-b border-r border-slate-300">
                      {p.name.replace('Аптека ', '').replace(' — ', ' ')}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-bold bg-slate-300 border-b border-slate-400 min-w-[100px]">ИТОГО</th>
                </tr>
              </thead>
              <tbody>
                {MONTHLY_REPORT_ROWS.map((row) => {
                  if (row.section) {
                    return (
                      <tr key={row.key} className="bg-slate-100">
                        <td colSpan={pharmacies.length + 2}
                          className="px-3 py-1.5 font-bold text-slate-600 uppercase tracking-wide text-xs sticky left-0 bg-slate-100">
                          {row.label}
                        </td>
                      </tr>
                    );
                  }

                  const total = rowTotal(row.key);
                  const isCalc = row.source === 'calc';
                  const isSummaryRow = row.key === 'totalExpenses' || row.key === 'netIncome';
                  const rowIdx = rowIndexMap.get(row.key)!;

                  // Цвет колонки ИТОГО
                  let totalCellClass = 'text-slate-800';
                  if (total === 0) {
                    totalCellClass = 'text-slate-300';
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
                    <tr key={row.key} className={`border-b border-slate-200 ${isSummaryRow ? 'bg-slate-50' : ''}`}>
                      {/* Название + настройка типа */}
                      <td className={`px-3 py-1.5 sticky left-0 bg-white border-r border-slate-300 ${
                        isSummaryRow ? 'bg-slate-50' : ''
                      } ${row.bold ? 'font-semibold text-slate-800' : 'text-slate-700'} ${row.indent ? 'pl-6' : ''}`}>
                        {row.label}
                      </td>

                      {/* Ячейки по аптекам */}
                      {pharmacies.map((p, colIdx) => {
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
                            locked={isClosed}
                            isSelected={!isClosed && selected?.rowIdx === rowIdx && selected?.colIdx === colIdx}
                            onSelect={() => setSelected({ rowIdx, colIdx })}
                            onNavigate={(dir) => navigate(rowIdx, colIdx, dir)}
                            cellRef={registerCellRef(rowIdx, colIdx)}
                          />
                        );
                      })}

                      {/* ИТОГО */}
                      <td className={`px-2 py-1.5 text-right tabular-nums border-l border-slate-300 ${totalCellClass}`}>
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
