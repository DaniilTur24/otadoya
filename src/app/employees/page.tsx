'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Employee {
  id: number;
  name: string;
  baseSalary: number;
  isActive: boolean;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', baseSalary: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    fetch('/api/employees')
      .then((r) => r.json())
      .then((data) => { setEmployees(data); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name.trim(), baseSalary: form.baseSalary || 0 }),
    });
    if (res.ok) {
      setForm({ name: '', baseSalary: '' });
      setShowForm(false);
      load();
    } else {
      const data = await res.json();
      setError(data.error || 'Ошибка при создании');
    }
    setSaving(false);
  }

  async function toggleActive(id: number, current: boolean) {
    await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    });
    load();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Удалить сотрудника «${name}»?\n\nЗаписи выручки останутся, но привязка к этому сотруднику будет потеряна.`)) return;
    await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    load();
  }

  const active = employees.filter((e) => e.isActive);
  const inactive = employees.filter((e) => !e.isActive);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Сотрудники</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary text-sm"
        >
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Управление сотрудниками: оклад, статус, история смен и расчёт зарплаты.
      </p>

      {showForm && (
        <form onSubmit={handleCreate} className="card p-4 mb-6 space-y-3">
          <h2 className="font-semibold text-gray-800 text-sm">Новый сотрудник</h2>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
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
              <label className="label">Оклад (₸)</label>
              <input
                type="number"
                value={form.baseSalary}
                onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))}
                min="0"
                step="1"
                placeholder="0"
                className="input"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-primary text-sm" disabled={saving}>
              {saving ? 'Сохранение...' : 'Создать'}
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
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : (
        <>
          <div className="card divide-y divide-gray-100 mb-4">
            {active.length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-400 text-center">
                Нет активных сотрудников. Нажмите «+ Добавить».
              </div>
            ) : (
              active.map((emp) => (
                <EmployeeRow key={emp.id} emp={emp} onToggle={toggleActive} onDelete={handleDelete} />
              ))
            )}
          </div>

          {inactive.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-6">
                Неактивные
              </h2>
              <div className="card divide-y divide-gray-100">
                {inactive.map((emp) => (
                  <EmployeeRow key={emp.id} emp={emp} onToggle={toggleActive} onDelete={handleDelete} />
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
  onToggle,
  onDelete,
}: {
  emp: Employee;
  onToggle: (id: number, current: boolean) => void;
  onDelete: (id: number, name: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${emp.isActive ? 'text-gray-900' : 'text-gray-400'}`}>
          {emp.name}
          {!emp.isActive && <span className="ml-2 text-xs text-gray-400">(неактивен)</span>}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          Оклад: <span className="text-gray-600 font-medium">
            {emp.baseSalary.toLocaleString('ru-RU')} ₸
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/employees/${emp.id}`}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50"
        >
          Зарплата / изменить
        </Link>
        <button
          onClick={() => onToggle(emp.id, emp.isActive)}
          className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
            emp.isActive
              ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
              : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
          }`}
        >
          {emp.isActive ? 'Деактивировать' : 'Активировать'}
        </button>
        <button
          onClick={() => onDelete(emp.id, emp.name)}
          className="text-xs font-medium px-2 py-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}
