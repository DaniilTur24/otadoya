'use client';

import { useState, useEffect } from 'react';

interface Pharmacy {
  id: number;
  name: string;
  keywords: string;
  coefficient: number;
  terminalRent: number;
  procedureRent: number;
}

interface PharmacyEdit {
  name: string;
  keywords: string;
  coefficient: string;
  terminalRent: string;
  procedureRent: string;
}

export default function SettingsPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [edits, setEdits] = useState<Record<number, PharmacyEdit>>({});
  const [rentOn, setRentOn] = useState<Record<number, { terminal: boolean; procedure: boolean }>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then((data: Pharmacy[]) => {
        setPharmacies(data);
        const initial: Record<number, PharmacyEdit> = {};
        const initialRent: Record<number, { terminal: boolean; procedure: boolean }> = {};
        for (const p of data) {
          initial[p.id] = {
            name: p.name,
            keywords: p.keywords ?? '',
            coefficient: p.coefficient ? String(p.coefficient) : '',
            terminalRent: p.terminalRent ? String(p.terminalRent) : '',
            procedureRent: p.procedureRent ? String(p.procedureRent) : '',
          };
          initialRent[p.id] = {
            terminal: Number(p.terminalRent) > 0,
            procedure: Number(p.procedureRent) > 0,
          };
        }
        setEdits(initial);
        setRentOn(initialRent);
        setLoading(false);
      });
  }, []);

  function toggleRent(id: number, type: 'terminal' | 'procedure', on: boolean) {
    setRentOn((r) => ({ ...r, [id]: { ...r[id], [type]: on } }));
    if (!on) {
      const field = type === 'terminal' ? 'terminalRent' : 'procedureRent';
      setEdits((e) => ({ ...e, [id]: { ...e[id], [field]: '0' } }));
    }
  }

  function setField(id: number, field: keyof PharmacyEdit, value: string) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [field]: value } }));
  }

  async function save(id: number) {
    setSaving(id);
    const e = edits[id];
    await fetch(`/api/pharmacies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: e.name,
        keywords: e.keywords,
        coefficient:   e.coefficient   ? parseFloat(e.coefficient)   : 0,
        terminalRent:  e.terminalRent  ? parseFloat(e.terminalRent)  : 0,
        procedureRent: e.procedureRent ? parseFloat(e.procedureRent) : 0,
      }),
    });
    setPharmacies((ps) => ps.map((p) => (p.id === id ? {
      ...p, name: e.name, keywords: e.keywords,
      coefficient:   parseFloat(e.coefficient)   || 0,
      terminalRent:  parseFloat(e.terminalRent)  || 0,
      procedureRent: parseFloat(e.procedureRent) || 0,
    } : p)));
    setSaving(null);
    setSaved(id);
    setTimeout(() => setSaved(null), 2000);
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Удалить аптеку "${name}"? Все связанные данные (выручка, расходы) также будут удалены.`)) return;
    setDeleting(id);
    await fetch(`/api/pharmacies/${id}`, { method: 'DELETE' });
    setPharmacies((ps) => ps.filter((p) => p.id !== id));
    setDeleting(null);
  }

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch('/api/pharmacies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const p: Pharmacy = await res.json();
    setPharmacies((ps) => [...ps, p]);
    setEdits((e) => ({ ...e, [p.id]: { name: p.name, keywords: '', coefficient: '', terminalRent: '', procedureRent: '' } }));
    setRentOn((r) => ({ ...r, [p.id]: { terminal: false, procedure: false } }));
    setNewName('');
    setCreating(false);
  }

  function isDirty(id: number, original: Pharmacy) {
    const e = edits[id];
    if (!e) return false;
    return (
      e.name !== original.name ||
      e.keywords !== (original.keywords ?? '') ||
      e.coefficient !== (original.coefficient ? String(original.coefficient) : '') ||
      e.terminalRent !== (original.terminalRent ? String(original.terminalRent) : '') ||
      e.procedureRent !== (original.procedureRent ? String(original.procedureRent) : '')
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Настройки аптек</h1>
      <p className="text-sm text-gray-500 mb-6">
        Ключевые слова — для авто-привязки аренды из банковских выписок.
        Аренда терминал и процедурная аренда — фиксированные суммы расходов, подставляются в закрытие месяца автоматически.
      </p>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : (
        <>
          <div className="card divide-y divide-gray-100 mb-6">
            {pharmacies.map((p) => {
              const e = edits[p.id];
              if (!e) return null;
              return (
                <div key={p.id} className="p-4 space-y-3">
                  {/* Строка 1: название, коэффициент, кнопки */}
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[160px]">
                      <label className="label">Название аптеки</label>
                      <input
                        type="text"
                        className="input"
                        value={e.name}
                        onChange={(ev) => setField(p.id, 'name', ev.target.value)}
                      />
                    </div>
                    <div className="w-28 shrink-0">
                      <label className="label">Коэффициент</label>
                      <input
                        type="number"
                        className="input"
                        placeholder="1.00"
                        min="0"
                        step="0.01"
                        value={e.coefficient}
                        onChange={(ev) => setField(p.id, 'coefficient', ev.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2 pb-0.5">
                      <button
                        className="btn-primary text-sm"
                        disabled={saving === p.id || !isDirty(p.id, p)}
                        onClick={() => save(p.id)}
                      >
                        {saving === p.id ? 'Сохранение...' : 'Сохранить'}
                      </button>
                      {saved === p.id && <span className="text-green-600 text-xs">Сохранено</span>}
                      <button
                        className="text-sm text-red-400 hover:text-red-600 disabled:opacity-40"
                        disabled={deleting === p.id}
                        onClick={() => remove(p.id, p.name)}
                      >
                        {deleting === p.id ? '...' : 'Удалить'}
                      </button>
                    </div>
                  </div>

                  {/* Строка 2: ключевые слова */}
                  <div>
                    <label className="label">
                      Ключевые слова для авто-привязки аренды
                      <span className="ml-1 text-gray-400 font-normal">(через запятую)</span>
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="например: сункар, хисамутдинов"
                      value={e.keywords}
                      onChange={(ev) => setField(p.id, 'keywords', ev.target.value)}
                    />
                  </div>

                  {/* Строка 3: типы аренды */}
                  <div>
                    <p className="label mb-2">Фиксированные расходы по аренде</p>
                    <div className="flex flex-wrap gap-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`terminal-${p.id}`}
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                          checked={rentOn[p.id]?.terminal ?? false}
                          onChange={(ev) => toggleRent(p.id, 'terminal', ev.target.checked)}
                        />
                        <label htmlFor={`terminal-${p.id}`} className="text-sm text-gray-700 cursor-pointer">
                          Аренда терминал
                        </label>
                        {rentOn[p.id]?.terminal && (
                          <input
                            type="number"
                            className="input w-36"
                            placeholder="Сумма"
                            min="0"
                            step="0.01"
                            value={e.terminalRent === '0' ? '' : e.terminalRent}
                            onChange={(ev) => setField(p.id, 'terminalRent', ev.target.value)}
                          />
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`procedure-${p.id}`}
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                          checked={rentOn[p.id]?.procedure ?? false}
                          onChange={(ev) => toggleRent(p.id, 'procedure', ev.target.checked)}
                        />
                        <label htmlFor={`procedure-${p.id}`} className="text-sm text-gray-700 cursor-pointer">
                          Процедурная аренда
                        </label>
                        {rentOn[p.id]?.procedure && (
                          <input
                            type="number"
                            className="input w-36"
                            placeholder="Сумма"
                            min="0"
                            step="0.01"
                            value={e.procedureRent === '0' ? '' : e.procedureRent}
                            onChange={(ev) => setField(p.id, 'procedureRent', ev.target.value)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Создание новой аптеки */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Добавить аптеку</h2>
            <div className="flex gap-3 items-end">
              <div className="flex-1 max-w-sm">
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
  );
}
