'use client';

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EMPLOYEE_TYPE_LABELS, canMarkAttendance } from '@/lib/employee-types';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

interface Pharmacy { id: number; name: string }
interface Employee {
  id: number;
  name: string;
  employeeType: string;
  isActive: boolean;
  pharmacies: Pharmacy[];
  fiveDayViaAttendance?: boolean;
}

const isAttendanceEligible = canMarkAttendance;
interface AttendanceRecord {
  id: number;
  employeeId: number;
  pharmacyId: number | null;
  date: string;
  overtimeHours: number;
}

interface PopupState {
  rowIdx: number;
  day: number;
  top: number;
  left: number;
  hours: string;
}

const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function dateStr(year: number, month: number, day: number) { return `${year}-${pad(month)}-${pad(day)}`; }
function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
function isWeekend(year: number, month: number, day: number) {
  const w = new Date(year, month - 1, day).getDay();
  return w === 0 || w === 6;
}

type Cursor = { rowIdx: number; day: number };

export default function AttendancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [rowPharmacy, setRowPharmacy] = useState<Record<number, number | ''>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [popup, setPopup] = useState<PopupState | null>(null);

  const [selected, setSelected] = useState<Cursor | null>(null);
  const [anchor, setAnchor] = useState<Cursor | null>(null);
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const popupRef = useRef<HTMLDivElement>(null);

  function setCellBusy(key: string, isBusy: boolean) {
    setBusyCells((s) => {
      const next = new Set(s);
      if (isBusy) next.add(key); else next.delete(key);
      return next;
    });
  }

  const numDays = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: numDays }, (_, i) => i + 1), [numDays]);

  // Лёгкое обновление данных после мутации (тоггл/массовое действие) — НЕ трогает
  // selected/anchor, иначе курсор сбрасывался бы после каждого клика и ломал
  // последовательную работу со стрелками/диапазоном.
  const refreshData = useCallback(async () => {
    const [emps, recs] = await Promise.all([
      fetch('/api/employees?isActive=true').then((r) => r.json()),
      fetch(`/api/attendance?year=${year}&month=${month}`).then((r) => r.json()),
    ]);
    setEmployees((emps as Employee[]).filter(isAttendanceEligible));
    setRecords(recs);
  }, [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    await refreshData();
    setSelected(null);
    setAnchor(null);
    setLoading(false);
  }, [refreshData]);

  useEffect(() => { load(); }, [load]);

  const groups: { type: string; label: string; items: Employee[] }[] = ['manager_fixed', 'pharmacy_manager', 'cleaner', 'office', 'seller_five_day_fixed']
    .map((type) => ({ type, label: EMPLOYEE_TYPE_LABELS[type], items: employees.filter((e) => e.employeeType === type) }))
    .concat([
      {
        type: 'seller_five_day',
        label: 'Продавцы (пятидневка)',
        items: employees.filter((e) => e.employeeType === 'seller' && e.fiveDayViaAttendance),
      },
      {
        type: 'manager_trading_five_day',
        label: 'Заведующие (пятидневка)',
        items: employees.filter((e) => e.employeeType === 'manager_trading' && e.fiveDayViaAttendance),
      },
    ])
    .filter((g) => g.items.length > 0);

  const flatEmployees = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Карта "employeeId-день" → запись табеля, для O(1) определения отметки в ячейке
  const recordMap = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const r of records) {
      const d = new Date(r.date);
      m.set(`${r.employeeId}-${d.getDate()}`, r);
    }
    return m;
  }, [records]);

  function markedDays(employeeId: number): number[] {
    const result: number[] = [];
    for (const day of days) {
      if (recordMap.has(`${employeeId}-${day}`)) result.push(day);
    }
    return result;
  }

  function overtimeTotal(employeeId: number): number {
    let total = 0;
    for (const day of days) {
      total += recordMap.get(`${employeeId}-${day}`)?.overtimeHours ?? 0;
    }
    return total;
  }

  function pharmacyForRow(emp: Employee): number | null {
    if (rowPharmacy[emp.id] !== undefined) return rowPharmacy[emp.id] || null;
    return emp.pharmacies[0]?.id ?? null;
  }

  useEffect(() => {
    if (!selected) return;
    cellRefs.current.get(`${selected.rowIdx}-${selected.day}`)?.focus();
  }, [selected]);

  function registerCellRef(rowIdx: number, day: number) {
    return (el: HTMLTableCellElement | null) => {
      const key = `${rowIdx}-${day}`;
      if (el) cellRefs.current.set(key, el);
      else cellRefs.current.delete(key);
    };
  }

  function openPopup(rowIdx: number, day: number) {
    const emp = flatEmployees[rowIdx];
    if (!emp) return;
    const cellEl = cellRefs.current.get(`${rowIdx}-${day}`);
    const rect = cellEl?.getBoundingClientRect();
    const existing = recordMap.get(`${emp.id}-${day}`);
    setPopup({
      rowIdx,
      day,
      top: rect ? rect.bottom + 6 : 100,
      left: rect ? rect.left : 100,
      hours: existing && existing.overtimeHours > 0 ? String(existing.overtimeHours) : '',
    });
  }

  // Клик по ячейке больше не тоггает мгновенно — открывает попап, чтобы можно было
  // сразу указать часы переработки за этот день (или просто подтвердить без часов).
  async function submitPopup() {
    if (!popup) return;
    const emp = flatEmployees[popup.rowIdx];
    if (!emp) return;
    const key = `${emp.id}-${popup.day}`;
    const existing = recordMap.get(key);
    const raw = popup.hours.trim();
    const hours = raw === '' ? 0 : Number(raw.replace(',', '.'));
    if (Number.isNaN(hours) || hours < 0) {
      setError('Некорректное значение часов');
      return;
    }
    setError('');
    setPopup(null);
    setCellBusy(key, true);
    try {
      const res = existing
        ? await fetch(`/api/attendance/${existing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ overtimeHours: hours }),
          })
        : await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeId: emp.id,
              date: dateStr(year, month, popup.day),
              pharmacyId: pharmacyForRow(emp),
              overtimeHours: hours,
            }),
          });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Ошибка сохранения');
      }
      await refreshData();
    } finally {
      setCellBusy(key, false);
    }
  }

  async function removeMark() {
    if (!popup) return;
    const emp = flatEmployees[popup.rowIdx];
    if (!emp) return;
    const key = `${emp.id}-${popup.day}`;
    const existing = recordMap.get(key);
    setPopup(null);
    if (!existing) return;
    setError('');
    setCellBusy(key, true);
    try {
      await fetch(`/api/attendance/${existing.id}`, { method: 'DELETE' });
      await refreshData();
    } finally {
      setCellBusy(key, false);
    }
  }

  useEffect(() => {
    if (!popup) return;
    function handleDocMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    }
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [popup]);

  function selectCell(rowIdx: number, day: number, extend: boolean) {
    const cur = { rowIdx, day };
    if (extend && anchor && anchor.rowIdx === rowIdx) {
      setSelected(cur);
    } else {
      setAnchor(cur);
      setSelected(cur);
    }
  }

  function handleCellClick(rowIdx: number, day: number, e: React.MouseEvent) {
    if (e.shiftKey && anchor && anchor.rowIdx === rowIdx) {
      selectCell(rowIdx, day, true);
    } else {
      selectCell(rowIdx, day, false);
      openPopup(rowIdx, day);
    }
  }

  function handleKeyDown(rowIdx: number, day: number, e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setPopup(null);
        selectCell(rowIdx, Math.max(1, day - 1), e.shiftKey);
        break;
      case 'ArrowRight':
        e.preventDefault();
        setPopup(null);
        selectCell(rowIdx, Math.min(numDays, day + 1), e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setPopup(null);
        selectCell(Math.max(0, rowIdx - 1), day, false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setPopup(null);
        selectCell(Math.min(flatEmployees.length - 1, rowIdx + 1), day, false);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        openPopup(rowIdx, day);
        break;
      case 'Escape':
        e.preventDefault();
        if (popup) setPopup(null); else setAnchor(selected);
        break;
    }
  }

  const hasRange = !!(anchor && selected && anchor.rowIdx === selected.rowIdx && anchor.day !== selected.day);
  const rangeDays = hasRange && anchor && selected
    ? days.filter((d) => d >= Math.min(anchor.day, selected.day) && d <= Math.max(anchor.day, selected.day))
    : [];

  async function applyRange(mark: boolean) {
    if (!hasRange || !selected) return;
    const emp = flatEmployees[selected.rowIdx];
    if (!emp) return;
    setBusy(true);
    setError('');
    try {
      const current = new Set(markedDays(emp.id));
      if (mark) rangeDays.forEach((d) => current.add(d));
      else rangeDays.forEach((d) => current.delete(d));

      const res = await fetch('/api/attendance/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: emp.id,
          pharmacyId: pharmacyForRow(emp),
          year, month,
          dates: [...current].map((d) => dateStr(year, month, d)),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Ошибка сохранения');
      }
      setAnchor(selected);
      await refreshData();
    } finally {
      setBusy(false);
    }
  }

  function goToMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  return (
    <div className="max-w-full">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Табель посещаемости</h1>
      <p className="text-sm text-slate-500 mb-4">
        Клик по ячейке открывает окно отметки: подтвердите без часов или укажите переработку за этот день.
        Стрелки перемещают выделение, Shift+стрелка или Shift+клик в той же строке — выбрать диапазон дней,
        появятся кнопки массового действия (без учёта часов). Esc — закрыть окно/сбросить диапазон.
      </p>

      <div className="card p-3 mb-4 flex flex-wrap items-end gap-4">
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
          <input
            type="number" className="input w-24" min={2020} max={2099}
            value={year} onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => goToMonth(-1)}>← Пред.</button>
          <button type="button" className="btn-secondary" onClick={() => goToMonth(1)}>След. →</button>
        </div>
        {hasRange && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-slate-500">Выделено {rangeDays.length} дн.</span>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => applyRange(true)}>
              {busy && <span className="spinner" />}Отметить
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => applyRange(false)}>
              {busy && <span className="spinner" />}Снять
            </button>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setAnchor(selected)}>✕</button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : flatEmployees.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">
          Нет сотрудников с типом «Уборщица», «Офис», «Менеджер», «Заведующая (не торгует)», «Суточник / пятидневка (фикс)» или продавцов/заведующих с включённой пятидневкой по табелю.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="th sticky left-0 z-20 bg-slate-200 text-left px-3 py-2 min-w-[180px]">Сотрудник</th>
                {days.map((d) => {
                  const weekend = isWeekend(year, month, d);
                  return (
                    <th key={d} className={`th text-center px-1.5 py-2 w-8 ${weekend ? 'bg-slate-300' : ''}`}>
                      <div>{d}</div>
                      <div className={`text-[10px] font-normal ${weekend ? 'text-red-500' : 'text-slate-500'}`}>
                        {WEEKDAY_SHORT[new Date(year, month - 1, d).getDay()]}
                      </div>
                    </th>
                  );
                })}
                <th className="th text-center px-2 py-2">Итого</th>
                <th className="th text-center px-2 py-2 min-w-[90px]">Переработка (ч)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.type}>
                  <tr key={`h-${g.type}`}>
                    <td colSpan={days.length + 3} className="bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
                      {g.label}
                    </td>
                  </tr>
                  {g.items.map((emp) => {
                    const rowIdx = flatEmployees.indexOf(emp);
                    const needsPharmacy = emp.employeeType !== 'office' && emp.pharmacies.length > 1;
                    const total = markedDays(emp.id).length;
                    return (
                      <tr key={emp.id}>
                        <td className="td sticky left-0 bg-white px-3 py-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-800">{emp.name}</span>
                            {needsPharmacy && (
                              <select
                                className="input w-32 text-xs py-0.5"
                                value={pharmacyForRow(emp) ?? ''}
                                onChange={(e) => setRowPharmacy((s) => ({ ...s, [emp.id]: e.target.value ? Number(e.target.value) : '' }))}
                              >
                                {emp.pharmacies.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        {days.map((day) => {
                          const record = recordMap.get(`${emp.id}-${day}`);
                          const marked = !!record;
                          const hasOvertime = !!record && record.overtimeHours > 0;
                          const cellKey = `${emp.id}-${day}`;
                          const cellBusy = busyCells.has(cellKey);
                          const isSelected = selected?.rowIdx === rowIdx && selected?.day === day;
                          const inRange = hasRange && selected?.rowIdx === rowIdx && anchor && rangeDays.includes(day) && anchor.rowIdx === rowIdx;
                          const weekend = isWeekend(year, month, day);
                          return (
                            <td
                              key={day}
                              ref={registerCellRef(rowIdx, day)}
                              tabIndex={isSelected ? 0 : -1}
                              onClick={(e) => !cellBusy && handleCellClick(rowIdx, day, e)}
                              onKeyDown={(e) => !cellBusy && handleKeyDown(rowIdx, day, e)}
                              title={hasOvertime ? `Переработка: ${record!.overtimeHours} ч` : undefined}
                              className={[
                                'text-center px-1.5 py-1.5 select-none border border-slate-200 outline-none',
                                cellBusy ? 'cursor-wait' : 'cursor-pointer',
                                marked
                                  ? (hasOvertime ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')
                                  : (weekend ? 'bg-slate-50 text-slate-300' : 'text-slate-300'),
                                isSelected ? 'ring-2 ring-blue-400 ring-inset' : '',
                                inRange && !isSelected ? 'bg-blue-50' : '',
                              ].join(' ')}
                            >
                              {cellBusy ? <span className="spinner" /> : (marked ? '✓' : '·')}
                            </td>
                          );
                        })}
                        <td className="td text-center font-medium text-slate-600">{total}</td>
                        <td className="td text-center font-medium text-slate-600">
                          {overtimeTotal(emp.id) > 0 ? overtimeTotal(emp.id) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {popup && (() => {
        const emp = flatEmployees[popup.rowIdx];
        if (!emp) return null;
        const existing = recordMap.get(`${emp.id}-${popup.day}`);
        return (
          <div
            ref={popupRef}
            style={{ top: popup.top, left: popup.left }}
            className="fixed z-30 w-56 card p-3 space-y-2 shadow-lg"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setPopup(null); }
              if (e.key === 'Enter') { e.preventDefault(); submitPopup(); }
            }}
          >
            <div className="text-sm font-medium text-slate-800">
              {emp.name} — {dateStr(year, month, popup.day)}
            </div>
            <div>
              <label className="label">Часы переработки (необязательно)</label>
              <input
                type="number"
                min={0}
                step="0.5"
                autoFocus
                placeholder="0"
                className="input"
                value={popup.hours}
                onChange={(e) => setPopup((p) => (p ? { ...p, hours: e.target.value } : p))}
              />
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-primary text-sm flex-1" onClick={submitPopup}>
                {existing ? 'Сохранить' : 'Подтвердить'}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setPopup(null)}>
                Отмена
              </button>
            </div>
            {existing && (
              <button type="button" className="text-xs text-red-600 hover:text-red-700" onClick={removeMark}>
                Снять отметку
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
