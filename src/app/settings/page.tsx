'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Pharmacy {
  id: number;
  name: string;
  isActive: boolean;
  keywords: string;
  coefficient: number;
  terminalRent: number;
  procedureRent: number;
}

export default function SettingsPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading]       = useState(true);
  const [newName, setNewName]       = useState('');
  const [creating, setCreating]     = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  function load() {
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then((data) => { setPharmacies(data); setSelectedIds(new Set()); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    await fetch('/api/pharmacies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName('');
    setCreating(false);
    load();
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Удалить аптеку «${name}»?\n\nВсе связанные данные (выручка, расходы) также будут удалены.`)) return;
    await fetch(`/api/pharmacies/${id}`, { method: 'DELETE' });
    setPharmacies((ps) => ps.filter((p) => p.id !== id));
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
      s.size === pharmacies.length ? new Set() : new Set(pharmacies.map((p) => p.id))
    );
  }

  async function removeSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} выбранных аптек?\n\nВсе связанные данные (выручка, расходы) также будут удалены.`)) return;
    await Promise.all(
      Array.from(selectedIds).map((id) => fetch(`/api/pharmacies/${id}`, { method: 'DELETE' }))
    );
    setPharmacies((ps) => ps.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Настройки</h1>
      <p className="text-sm text-gray-500 mb-6">
        Управление аптеками, алиасами и правилами импорта банковских транзакций.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Link href="/employees" className="card p-4 hover:bg-gray-50">
          <div className="font-semibold text-gray-900">Сотрудники</div>
          <div className="text-xs text-gray-500 mt-1">Оклады, смены, расчёт зарплаты за месяц.</div>
        </Link>
        <Link href="/settings/pharmacy-aliases" className="card p-4 hover:bg-gray-50">
          <div className="font-semibold text-gray-900">Алиасы аптек</div>
          <div className="text-xs text-gray-500 mt-1">ИП, контрагенты, ИИН/БИН и ключевые слова.</div>
        </Link>
        <Link href="/settings/transaction-rules" className="card p-4 hover:bg-gray-50">
          <div className="font-semibold text-gray-900">Правила транзакций</div>
          <div className="text-xs text-gray-500 mt-1">Классификация и распределение строк банка.</div>
        </Link>
        <Link href="/settings/working-calendar" className="card p-4 hover:bg-gray-50">
          <div className="font-semibold text-gray-900">Производственный календарь</div>
          <div className="text-xs text-gray-500 mt-1">Рабочие дни по месяцам для расчёта пятидневной смены.</div>
        </Link>
        <Link href="/settings/office-premium" className="card p-4 hover:bg-gray-50">
          <div className="font-semibold text-gray-900">Премия офиса</div>
          <div className="text-xs text-gray-500 mt-1">Лестница премии офисных сотрудников от выручки всех аптек.</div>
        </Link>
        <Link href="/attendance" className="card p-4 hover:bg-gray-50">
          <div className="font-semibold text-gray-900">Табель посещаемости</div>
          <div className="text-xs text-gray-500 mt-1">Отметки смен уборщиц, офиса и заведующих без торговли.</div>
        </Link>
      </div>

      <div className="max-w-2xl">
      <h2 className="font-semibold text-gray-800 mb-3">Аптеки</h2>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : (
        <>
          {pharmacies.length > 0 && (
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={selectedIds.size === pharmacies.length}
                  onChange={toggleSelectAll}
                />
                Выбрать все
              </label>
              {selectedIds.size > 0 && (
                <button className="btn-danger text-xs" onClick={removeSelected}>
                  Удалить выбранные ({selectedIds.size})
                </button>
              )}
            </div>
          )}
          <div className="card divide-y divide-gray-100 mb-6">
            {pharmacies.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="rounded shrink-0"
                  checked={selectedIds.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-3">
                    <span className={p.isActive ? 'text-green-600' : 'text-gray-400'}>
                      {p.isActive ? 'Активна' : 'Неактивна'}
                    </span>
                    {p.keywords && (
                      <span>Ключевые слова: <span className="text-gray-600">{p.keywords}</span></span>
                    )}
                    {Number(p.coefficient) > 0 && (
                      <span>Коэффициент: <span className="text-gray-600">{p.coefficient}</span></span>
                    )}
                    {Number(p.terminalRent) > 0 && (
                      <span>Аренда терминал: <span className="text-gray-600">{Number(p.terminalRent).toLocaleString('ru-RU')}</span></span>
                    )}
                    {Number(p.procedureRent) > 0 && (
                      <span>Процедурная аренда: <span className="text-gray-600">{Number(p.procedureRent).toLocaleString('ru-RU')}</span></span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/settings/pharmacies/${p.id}`} className="btn-secondary text-xs">
                    Изменить →
                  </Link>
                  <button
                    className="text-sm text-red-400 hover:text-red-600 px-2 py-1"
                    onClick={() => remove(p.id, p.name)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Добавить аптеку */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Добавить аптеку</h2>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="label">Название</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Аптека №6 — Южная"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
              </div>
              <button
                className="btn-primary text-sm"
                disabled={creating || !newName.trim()}
                onClick={create}
              >
                {creating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
