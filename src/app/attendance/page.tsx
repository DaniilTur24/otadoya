'use client';

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EMPLOYEE_TYPE_LABELS, ATTENDANCE_BASED_TYPES } from '@/lib/employee-types';

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
}
interface AttendanceRecord {
  id: number;
  employeeId: number;
  pharmacyId: number | null;
  date: string;
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
  const [error, setError] = useState('');

  const [selected, setSelected] = useState<Cursor | null>(null);
  const [anchor, setAnchor] = useState<Cursor | null>(null);
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

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
    setEmployees((emps as Employee[]).filter((e) => ATTENDANCE_BASED_TYPES.has(e.employeeType)));
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

  const groups: { type: string; label: string; items: Employee[] }[] = ['manager_fixed', 'pharmacy_manager', 'cleaner', 'office']
    .map((type) => ({ type, label: EMPLOYEE_TYPE_LABELS[type], items: employees.filter((e) => e.employeeType === type) }))
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

  async function toggleCell(rowIdx: number, day: number) {
    const emp = flatEmployees[rowIdx];
    if (!emp) return;
    setError('');
    const existing = recordMap.get(`${emp.id}-${day}`);
    setBusy(true);
    try {
      if (existing) {
        await fetch(`/api/attendance/${existing.id}`, { method: 'DELETE' });
      } else {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: emp.id, date: dateStr(year, month, day), pharmacyId: pharmacyForRow(emp) }),
        });
        if (!res.ok) {
          const d = await res.json();
          setError(d.error || 'Ошибка сохранения');
        }
      }
      await refreshData();
    } finally {
      setBusy(false);
    }
  }

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
      toggleCell(rowIdx, day);
    }
  }

  function handleKeyDown(rowIdx: number, day: number, e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        selectCell(rowIdx, Math.max(1, day - 1), e.shiftKey);
        break;
      case 'ArrowRight':
        e.preventDefault();
        selectCell(rowIdx, Math.min(numDays, day + 1), e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectCell(Math.max(0, rowIdx - 1), day, false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        selectCell(Math.min(flatEmployees.length - 1, rowIdx + 1), day, false);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        toggleCell(rowIdx, day);
        break;
      case 'Escape':
        e.preventDefault();
        setAnchor(selected);
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
      <h1 className="text-xl font-bold text-gray-900 mb-1">Табель посещаемости</h1>
      <p className="text-sm text-gray-500 mb-4">
        Клик по ячейке — отметить/снять день. Стрелки перемещают выделение, Shift+стрелка или Shift+клик
        в той же строке — выбрать диапазон дней, появятся кнопки массового действия. Enter/Space — тоггл текущей ячейки, Esc — сбросить диапазон.
      </p>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-4">
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
            <span className="text-gray-500">Выделено {rangeDays.length} дн.</span>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => applyRange(true)}>Отметить</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => applyRange(false)}>Снять</button>
            <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => setAnchor(selected)}>✕</button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : flatEmployees.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 text-sm">
          Нет сотрудников с типом «Уборщица», «Офис», «Менеджер» или «Заведующая (не торгует)».
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="th sticky left-0 bg-white text-left px-3 py-2 min-w-[180px]">Сотрудник</th>
                {days.map((d) => {
                  const weekend = isWeekend(year, month, d);
                  return (
                    <th key={d} className={`th text-center px-1.5 py-2 w-8 ${weekend ? 'bg-gray-50' : ''}`}>
                      <div>{d}</div>
                      <div className={`text-[10px] font-normal ${weekend ? 'text-red-400' : 'text-gray-400'}`}>
                        {WEEKDAY_SHORT[new Date(year, month - 1, d).getDay()]}
                      </div>
                    </th>
                  );
                })}
                <th className="th text-center px-2 py-2">Итого</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.type}>
                  <tr key={`h-${g.type}`}>
                    <td colSpan={days.length + 2} className="bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
                            <span className="text-gray-800">{emp.name}</span>
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
                          const marked = recordMap.has(`${emp.id}-${day}`);
                          const isSelected = selected?.rowIdx === rowIdx && selected?.day === day;
                          const inRange = hasRange && selected?.rowIdx === rowIdx && anchor && rangeDays.includes(day) && anchor.rowIdx === rowIdx;
                          const weekend = isWeekend(year, month, day);
                          return (
                            <td
                              key={day}
                              ref={registerCellRef(rowIdx, day)}
                              tabIndex={isSelected ? 0 : -1}
                              onClick={(e) => handleCellClick(rowIdx, day, e)}
                              onKeyDown={(e) => handleKeyDown(rowIdx, day, e)}
                              className={[
                                'text-center px-1.5 py-1.5 cursor-pointer select-none border border-gray-100 outline-none',
                                marked ? 'bg-green-100 text-green-700' : (weekend ? 'bg-gray-50 text-gray-300' : 'text-gray-300'),
                                isSelected ? 'ring-2 ring-blue-400 ring-inset' : '',
                                inRange && !isSelected ? 'bg-blue-50' : '',
                              ].join(' ')}
                            >
                              {marked ? '✓' : '·'}
                            </td>
                          );
                        })}
                        <td className="td text-center font-medium text-gray-600">{total}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
