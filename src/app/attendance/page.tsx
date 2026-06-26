'use client';

import { useState, useEffect, useCallback } from 'react';
import { EMPLOYEE_TYPE_LABELS, ATTENDANCE_BASED_TYPES } from '@/lib/employee-types';

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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AttendancePage() {
  const [date, setDate] = useState(todayStr());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedPharmacy, setSelectedPharmacy] = useState<Record<number, number | ''>>({});
  const [loading, setLoading] = useState(true);
  const [busyEmployeeId, setBusyEmployeeId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [emps, recs] = await Promise.all([
      fetch('/api/employees?isActive=true').then((r) => r.json()),
      fetch(`/api/attendance?date=${date}`).then((r) => r.json()),
    ]);
    setEmployees((emps as Employee[]).filter((e) => ATTENDANCE_BASED_TYPES.has(e.employeeType)));
    setRecords(recs);
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]));

  function pharmacyForEmployee(emp: Employee): number | '' {
    if (selectedPharmacy[emp.id] !== undefined) return selectedPharmacy[emp.id];
    return emp.pharmacies[0]?.id ?? '';
  }

  async function toggle(emp: Employee) {
    setError('');
    const existing = recordByEmployee.get(emp.id);
    setBusyEmployeeId(emp.id);
    try {
      if (existing) {
        await fetch(`/api/attendance/${existing.id}`, { method: 'DELETE' });
      } else {
        const pharmacyId = pharmacyForEmployee(emp);
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: emp.id, date, pharmacyId: pharmacyId || null }),
        });
        if (!res.ok) {
          const d = await res.json();
          setError(d.error || 'Ошибка сохранения');
        }
      }
      await load();
    } finally {
      setBusyEmployeeId(null);
    }
  }

  const groups: { type: string; label: string; items: Employee[] }[] = ['manager_fixed', 'pharmacy_manager', 'cleaner', 'office']
    .map((type) => ({
      type,
      label: EMPLOYEE_TYPE_LABELS[type],
      items: employees.filter((e) => e.employeeType === type),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="max-w-screen-lg">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Табель посещаемости</h1>
      <p className="text-sm text-slate-500 mb-4">
        Отметьте, кто отработал смену в этот день: уборщицы, офисные сотрудники и заведующие без торговли.
        Эти отметки используются для расчёта их зарплаты.
      </p>

      <div className="card p-3 mb-4 flex items-center gap-3">
        <label className="label mb-0 shrink-0">Дата</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input w-44"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center">Загрузка...</div>
      ) : groups.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">
          Нет сотрудников с типом «Уборщица», «Офис» или «Заведующая (не торгует)».
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.type}>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">{g.label}</h2>
              <div className="card divide-y divide-slate-100">
                {g.items.map((emp) => {
                  const marked = recordByEmployee.has(emp.id);
                  const needsPharmacy = emp.employeeType !== 'office' && emp.pharmacies.length > 1;
                  return (
                    <div key={emp.id} className="flex items-center gap-3 px-4 py-2.5">
                      <label className="flex items-center gap-2 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={marked}
                          disabled={busyEmployeeId === emp.id}
                          onChange={() => toggle(emp)}
                          className="rounded w-4 h-4"
                        />
                        <span className="text-sm text-slate-800">{emp.name}</span>
                      </label>
                      {needsPharmacy && !marked && (
                        <select
                          className="input w-44 text-xs"
                          value={pharmacyForEmployee(emp)}
                          onChange={(e) =>
                            setSelectedPharmacy((s) => ({ ...s, [emp.id]: e.target.value ? Number(e.target.value) : '' }))
                          }
                        >
                          {emp.pharmacies.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      )}
                      {marked && (
                        <span className="text-xs text-slate-400">
                          {recordByEmployee.get(emp.id)?.pharmacyId
                            ? emp.pharmacies.find((p) => p.id === recordByEmployee.get(emp.id)?.pharmacyId)?.name
                            : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
