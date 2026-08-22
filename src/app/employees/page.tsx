'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { EMPLOYEE_TYPE_LABELS, USER_LINKED_TYPES } from '@/lib/employee-types';

// Заведующих (manager_trading / manager_fixed) создают на /users — туда же
// автоматически попадает их карточка сотрудника. Здесь создаются только
// продавцы, уборщицы и офисные сотрудники.
const CREATABLE_TYPES = [
  { value: 'seller', label: 'Продавец' },
  { value: 'cleaner', label: 'Уборщица' },
  { value: 'office', label: 'Офис' },
] as const;

interface Pharmacy { id: number; name: string }
interface Employee {
  id: number;
  name: string;
  baseSalary: number;
  employeeType: string;
  shiftRate: number | null;
  allowance: number;
  allowanceDescription: string;
  isActive: boolean;
  pharmacies: Pharmacy[];
  fiveDayViaAttendance: boolean;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    employeeType: 'seller' as string,
    baseSalary: '',
    shiftRate: '',
    allowance: '',
    allowanceDescription: '',
    pharmacyIds: [] as number[],
    fiveDayViaAttendance: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/employees').then((r) => r.json()),
      fetch('/api/pharmacies').then((r) => r.json()),
    ]).then(([emps, pharms]) => {
      setEmployees(emps);
      setPharmacies(pharms);
      setSelectedIds(new Set());
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  function togglePharmacy(id: number) {
    setForm((f) => ({
      ...f,
      pharmacyIds: f.pharmacyIds.includes(id)
        ? f.pharmacyIds.filter((p) => p !== id)
        : [...f.pharmacyIds, id],
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.employeeType === 'cleaner') {
      if (!form.shiftRate || Number(form.shiftRate) <= 0) {
        setError('Укажите ставку за смену');
        return;
      }
    } else if (!form.baseSalary || Number(form.baseSalary) <= 0) {
      setError('Укажите оклад сотрудника');
      return;
    }
    if (form.pharmacyIds.length === 0) {
      setError('Выберите хотя бы одну аптеку');
      return;
    }
    setSaving(true);
    setError('');
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        employeeType: form.employeeType,
        baseSalary: form.baseSalary || 0,
        shiftRate: form.employeeType === 'cleaner' ? form.shiftRate || 0 : null,
        allowance: form.allowance || 0,
        allowanceDescription: form.allowanceDescription.trim(),
        fiveDayViaAttendance: form.employeeType === 'seller' ? form.fiveDayViaAttendance : false,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      if (form.pharmacyIds.length > 0) {
        await fetch(`/api/employees/${created.id}/pharmacies`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pharmacyIds: form.pharmacyIds }),
        });
      }
      setForm({ name: '', employeeType: 'seller', baseSalary: '', shiftRate: '', allowance: '', allowanceDescription: '', pharmacyIds: [], fiveDayViaAttendance: false });
      setShowForm(false);
      load();
    } else {
      const data = await res.json();
      setError(data.error || 'Ошибка при создании');
    }
    setSaving(false);
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Удалить сотрудника «${name}»?\n\nЗаписи выручки останутся, но привязка к этому сотруднику будет потеряна.`)) return;
    await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    load();
  }

  function toggleSelect(id: number) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} выбранных сотрудников?\n\nЗаписи выручки останутся, но привязка к этим сотрудникам будет потеряна.`)) return;
    await Promise.all(
      Array.from(selectedIds).map((id) => fetch(`/api/employees/${id}`, { method: 'DELETE' }))
    );
    setSelectedIds(new Set());
    load();
  }

  const active = employees.filter((e) => e.isActive);
  const inactive = employees.filter((e) => !e.isActive);

  return (
    <div className="max-w-screen-xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-900">Сотрудники</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary text-sm"
        >
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Управление сотрудниками: оклад, статус, история смен и расчёт зарплаты.
      </p>

      {showForm && (
        <form onSubmit={handleCreate} className="card p-3 mb-4 space-y-3">
          <h2 className="font-semibold text-slate-800 text-sm">Новый сотрудник</h2>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Имя *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                placeholder="Иванова А.В."
                className="input"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Тип сотрудника *</label>
              <select
                value={form.employeeType}
                onChange={(e) => setForm((f) => ({ ...f, employeeType: e.target.value }))}
                className="input"
              >
                {CREATABLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {form.employeeType === 'cleaner' ? (
              <div>
                <label className="label">Ставка за смену (₸) *</label>
                <input
                  type="number"
                  value={form.shiftRate}
                  onChange={(e) => setForm((f) => ({ ...f, shiftRate: e.target.value }))}
                  min="1"
                  step="1"
                  placeholder="5000"
                  className="input"
                  required
                />
              </div>
            ) : (
              <div>
                <label className="label">Оклад (₸) *</label>
                <input
                  type="number"
                  value={form.baseSalary}
                  onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))}
                  min="1"
                  step="1"
                  placeholder="150000"
                  className="input"
                  required
                />
              </div>
            )}
          </div>
          {form.employeeType === 'seller' && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.fiveDayViaAttendance}
                onChange={(e) => setForm((f) => ({ ...f, fiveDayViaAttendance: e.target.checked }))}
                className="rounded"
              />
              Пятидневка — отмечается в табеле посещаемости
              <span className="text-slate-400 font-normal">(вместо записи выручки на каждый рабочий день)</span>
            </label>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Фиксированная доплата (₸/мес)</label>
              <input
                type="number"
                value={form.allowance}
                onChange={(e) => setForm((f) => ({ ...f, allowance: e.target.value }))}
                min="0"
                step="1"
                placeholder="0"
                className="input"
              />
            </div>
            <div>
              <label className="label">За что доплата</label>
              <input
                type="text"
                value={form.allowanceDescription}
                onChange={(e) => setForm((f) => ({ ...f, allowanceDescription: e.target.value }))}
                placeholder="например: за стаж"
                className="input"
              />
            </div>
          </div>
          {pharmacies.length > 0 && (
            <div>
              <label className="label">Аптеки *</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                {pharmacies.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.pharmacyIds.includes(p.id)}
                      onChange={() => togglePharmacy(p.id)}
                      className="rounded"
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-primary text-sm" disabled={saving}>
              {saving && <span className="spinner" />}{saving ? 'Сохранение...' : 'Создать'}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => { setShowForm(false); setError(''); }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="card px-4 py-2 mb-3 bg-slate-100 border-slate-300 flex items-center justify-between">
              <span className="text-sm text-slate-900">Выбрано: {selectedIds.size}</span>
              <button className="btn-danger text-xs" onClick={deleteSelected}>
                Удалить выбранные
              </button>
            </div>
          )}
          <div className="card divide-y divide-slate-100 mb-4">
            {active.length === 0 ? (
              <div className="px-4 py-5 text-sm text-slate-500 text-center">
                Нет активных сотрудников. Нажмите «+ Добавить».
              </div>
            ) : (
              active.map((emp) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  isSelected={selectedIds.has(emp.id)}
                  onToggleSelect={toggleSelect}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>

          {inactive.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2 mt-4">
                Неактивные
              </h2>
              <div className="card divide-y divide-slate-100">
                {inactive.map((emp) => (
                  <EmployeeRow
                    key={emp.id}
                    emp={emp}
                    isSelected={selectedIds.has(emp.id)}
                    onToggleSelect={toggleSelect}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function EmployeeRow({
  emp,
  isSelected,
  onToggleSelect,
  onDelete,
}: {
  emp: Employee;
  isSelected: boolean;
  onToggleSelect: (id: number) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const isUserLinked = USER_LINKED_TYPES.has(emp.employeeType);

  return (
    <div className="px-3 py-2.5 hover:bg-slate-50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {isUserLinked ? (
          <span className="w-4 shrink-0" />
        ) : (
          <input
            type="checkbox"
            className="rounded mt-1 sm:mt-0 shrink-0"
            checked={isSelected}
            onChange={() => onToggleSelect(emp.id)}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className={`font-medium ${emp.isActive ? 'text-slate-900' : 'text-slate-400'}`}>
            {emp.name}
            {!emp.isActive && <span className="ml-2 text-xs text-slate-400">(неактивен)</span>}
          </div>
          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
              {EMPLOYEE_TYPE_LABELS[emp.employeeType] ?? emp.employeeType}
            </span>
            {emp.employeeType === 'cleaner' ? (
              <span>Ставка за смену: <span className="text-slate-600 font-medium">
                {(emp.shiftRate ?? 0).toLocaleString('ru-RU')} ₸
              </span></span>
            ) : (
              <span>Оклад: <span className="text-slate-600 font-medium">
                {emp.baseSalary.toLocaleString('ru-RU')} ₸
              </span></span>
            )}
            {emp.allowance > 0 && (
              <span title={emp.allowanceDescription || undefined}>
                Фиксированная доплата: <span className="text-slate-600 font-medium">
                  {emp.allowance.toLocaleString('ru-RU')} ₸
                </span>
                {emp.allowanceDescription && <span className="text-slate-400"> ({emp.allowanceDescription})</span>}
              </span>
            )}
          </div>
          {/* Аптеки */}
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {emp.pharmacies.length === 0 ? (
              <span className="text-xs text-amber-600">Аптека не привязана</span>
            ) : (
              emp.pharmacies.map((p) => (
                <span key={p.id} className="text-xs bg-slate-100 text-slate-800 border border-slate-300 px-1.5 py-0.5 rounded">
                  {p.name}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Link
            href={`/employees/${emp.id}`}
            className="text-xs text-slate-700 hover:text-slate-900 font-medium px-2 py-1 rounded hover:bg-slate-100"
          >
            Изменить/посмотреть
          </Link>
          {isUserLinked ? (
            <Link
              href="/users"
              title="Заведующие и менеджеры удаляются на странице «Заведующие»"
              className="text-xs font-medium px-2 py-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Удалить на /users
            </Link>
          ) : (
            <button
              onClick={() => onDelete(emp.id, emp.name)}
              className="text-xs font-medium px-2 py-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              Удалить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
