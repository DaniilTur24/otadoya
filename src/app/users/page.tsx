'use client';

import { useState, useEffect, useCallback } from 'react';

interface Pharmacy { id: number; name: string }
interface Manager {
  id: number;
  username: string;
  displayName: string;
  isActive: boolean;
  pharmacies: Pharmacy[];
}

export default function UsersPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    pharmacyIds: [] as number[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [mgrs, pharms] = await Promise.all([
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/pharmacies').then((r) => r.json()),
    ]);
    setManagers(mgrs);
    setPharmacies(pharms);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ username: '', password: '', displayName: '', pharmacyIds: [] });
    setEditingId(null);
    setShowForm(false);
    setError('');
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  function startEdit(m: Manager) {
    setForm({
      username: m.username,
      password: '',
      displayName: m.displayName,
      pharmacyIds: m.pharmacies.map((p) => p.id),
    });
    setEditingId(m.id);
    setShowForm(true);
    setError('');
  }

  function togglePharmacy(id: number) {
    setForm((f) => ({
      ...f,
      pharmacyIds: f.pharmacyIds.includes(id)
        ? f.pharmacyIds.filter((p) => p !== id)
        : [...f.pharmacyIds, id],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const body: Record<string, unknown> = {
      displayName: form.displayName,
      pharmacyIds: form.pharmacyIds,
    };

    let res: Response;
    if (editingId !== null) {
      if (form.password) body.password = form.password;
      res = await fetch(`/api/users/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      body.username = form.username;
      body.password = form.password;
      res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    if (res.ok) {
      setSuccess(editingId !== null ? 'Изменения сохранены' : 'Заведующий создан');
      setTimeout(() => setSuccess(''), 3000);
      resetForm();
      load();
    } else {
      const d = await res.json();
      setError(d.error || 'Ошибка сохранения');
    }
  }

  async function toggleActive(m: Manager) {
    await fetch(`/api/users/${m.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !m.isActive }),
    });
    load();
  }

  async function deleteManager(id: number) {
    if (!confirm('Удалить заведующего? Его записи выручки останутся.')) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Заведующие аптеками</h1>
        <button className="btn-primary text-sm" onClick={startCreate}>+ Добавить</button>
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Управление аккаунтами заведующих. Каждый заведующий видит только свои аптеки.
      </p>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-800 text-sm">
          {success}
        </div>
      )}

      {showForm && (
        <div className="card p-5 mb-6 border-blue-200 border-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">
              {editingId !== null ? 'Редактирование заведующего' : 'Новый заведующий'}
            </h2>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Логин *</label>
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required={editingId === null}
                  disabled={editingId !== null}
                  placeholder="username"
                />
                {editingId !== null && (
                  <p className="text-xs text-gray-400 mt-1">Логин изменить нельзя</p>
                )}
              </div>
              <div>
                <label className="label">
                  {editingId !== null ? 'Новый пароль (оставьте пустым — не менять)' : 'Пароль *'}
                </label>
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required={editingId === null}
                  placeholder="минимум 6 символов"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div>
              <label className="label">Имя для отображения *</label>
              <input
                className="input"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                required
                placeholder="Иванов Иван"
              />
            </div>

            <div>
              <label className="label">Аптеки (выберите одну или несколько)</label>
              {pharmacies.length === 0 ? (
                <p className="text-sm text-gray-400">Нет аптек в системе</p>
              ) : (
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
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button type="submit" className="btn-primary">
                {editingId !== null ? 'Сохранить' : 'Создать'}
              </button>
              <button type="button" className="btn-secondary" onClick={resetForm}>Отмена</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : managers.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 text-sm">
          Нет заведующих. Нажмите «+ Добавить» чтобы создать первого.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="th">Имя</th>
                <th className="th">Логин</th>
                <th className="th">Аптеки</th>
                <th className="th">Статус</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {managers.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{m.displayName}</td>
                  <td className="td text-gray-500 font-mono text-sm">{m.username}</td>
                  <td className="td">
                    {m.pharmacies.length === 0 ? (
                      <span className="text-amber-600 text-xs">Не привязан</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {m.pharmacies.map((p) => (
                          <span key={p.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      m.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {m.isActive ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button className="btn-secondary text-xs" onClick={() => startEdit(m)}>
                        Изменить
                      </button>
                      <button
                        className={`text-xs px-2 py-1 rounded font-medium border transition-colors ${
                          m.isActive
                            ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                            : 'border-green-300 text-green-700 hover:bg-green-50'
                        }`}
                        onClick={() => toggleActive(m)}
                      >
                        {m.isActive ? 'Отключить' : 'Включить'}
                      </button>
                      <button className="btn-danger text-xs" onClick={() => deleteManager(m.id)}>
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
