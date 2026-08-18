'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Pharmacy {
  id: number;
  name: string;
  isActive: boolean;
}

interface PharmacyAlias {
  id: number;
  pharmacyId: number;
  alias: string;
  aliasType: string;
  isActive: boolean;
  pharmacy: Pharmacy;
}

const ALIAS_TYPES = [
  ['name', 'Название'],
  ['ip_name', 'ИП / контрагент'],
  ['bin_iin', 'ИИН / БИН'],
  ['keyword', 'Ключевое слово'],
];

export default function PharmacyAliasesSettingsPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [aliases, setAliases] = useState<PharmacyAlias[]>([]);
  const [filterPharmacyId, setFilterPharmacyId] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    pharmacyId: '',
    alias: '',
    aliasType: 'keyword',
    isActive: true,
  });

  const load = useCallback(async () => {
    const params = filterPharmacyId ? `?pharmacyId=${filterPharmacyId}` : '';
    const [pharmacyRes, aliasRes] = await Promise.all([
      fetch('/api/pharmacies'),
      fetch(`/api/pharmacy-aliases${params}`),
    ]);
    setPharmacies(await pharmacyRes.json());
    setAliases(await aliasRes.json());
  }, [filterPharmacyId]);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setForm({ pharmacyId: '', alias: '', aliasType: 'keyword', isActive: true });
  }

  function startEdit(alias: PharmacyAlias) {
    setEditingId(alias.id);
    setForm({
      pharmacyId: String(alias.pharmacyId),
      alias: alias.alias,
      aliasType: alias.aliasType,
      isActive: alias.isActive,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(editingId ? `/api/pharmacy-aliases/${editingId}` : '/api/pharmacy-aliases', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    resetForm();
    load();
  }

  async function remove(alias: PharmacyAlias) {
    if (!confirm(`Удалить алиас «${alias.alias}»?`)) return;
    await fetch(`/api/pharmacy-aliases/${alias.id}`, { method: 'DELETE' });
    load();
  }

  async function toggle(alias: PharmacyAlias) {
    await fetch(`/api/pharmacy-aliases/${alias.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !alias.isActive }),
    });
    load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-5">
        <Link href="/settings" className="hover:text-slate-600">Настройки</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">Алиасы аптек</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-900 mb-1">Алиасы аптек</h1>
      <p className="text-sm text-slate-500 mb-4">
        По этим словам, ИП, контрагентам и ИИН/БИН система определяет аптеку в банковской строке.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        <form onSubmit={save} className="card p-4 space-y-3 h-fit">
          <h2 className="font-semibold text-slate-800">{editingId ? 'Редактировать алиас' : 'Добавить алиас'}</h2>
          <div>
            <label className="label">Аптека</label>
            <select className="input" value={form.pharmacyId} onChange={(e) => setForm((f) => ({ ...f, pharmacyId: e.target.value }))} required>
              <option value="">— выбрать —</option>
              {pharmacies.map((pharmacy) => (
                <option key={pharmacy.id} value={pharmacy.id}>
                  {pharmacy.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Алиас</label>
            <input
              className="input"
              placeholder="ИП Хамутдинов, 580429..."
              value={form.alias}
              onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Тип алиаса</label>
            <select className="input" value={form.aliasType} onChange={(e) => setForm((f) => ({ ...f, aliasType: e.target.value }))}>
              {ALIAS_TYPES.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="w-4 h-4 accent-slate-700"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Активно
          </label>
          <div className="flex gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving && <span className="spinner" />}{editingId ? 'Сохранить' : 'Создать'}
            </button>
            {editingId && <button className="btn-secondary" type="button" onClick={resetForm}>Отмена</button>}
          </div>
        </form>

        <div>
          <div className="card p-3 mb-3">
            <label className="label">Фильтр по аптеке</label>
            <select className="input max-w-sm" value={filterPharmacyId} onChange={(e) => setFilterPharmacyId(e.target.value)}>
              <option value="">Все аптеки</option>
              {pharmacies.map((pharmacy) => (
                <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>
              ))}
            </select>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Аптека</th>
                  <th className="th">Алиас</th>
                  <th className="th">Тип</th>
                  <th className="th">Статус</th>
                  <th className="th">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aliases.map((alias) => (
                  <tr key={alias.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{alias.pharmacy.name}</td>
                    <td className="td">{alias.alias}</td>
                    <td className="td text-slate-500">{ALIAS_TYPES.find(([key]) => key === alias.aliasType)?.[1] ?? alias.aliasType}</td>
                    <td className="td">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${alias.isActive ? 'bg-green-50 text-green-800 border-green-300' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>
                        {alias.isActive ? 'Активно' : 'Неактивно'}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex gap-2">
                        <button className="btn-secondary text-xs" onClick={() => startEdit(alias)}>Изменить</button>
                        <button className="btn-secondary text-xs" onClick={() => toggle(alias)}>{alias.isActive ? 'Отключить' : 'Включить'}</button>
                        <button className="btn-danger text-xs" onClick={() => remove(alias)}>Удалить</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
