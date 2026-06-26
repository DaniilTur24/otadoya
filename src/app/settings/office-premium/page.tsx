'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Tier {
  id: number;
  fromAmount: string;
  toAmount: string;
  bonusAmount: string;
}

let nextId = -1;

function emptyTier(): Tier {
  return { id: nextId--, fromAmount: '', toAmount: '', bonusAmount: '' };
}

export default function OfficePremiumSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [tiers, setTiers] = useState<Tier[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const data: { id: number; fromAmount: number; toAmount: number | null; bonusAmount: number }[] =
      await fetch('/api/office-premium-settings').then((r) => r.json());
    setTiers(
      data.length > 0
        ? data.map((t) => ({
            id: t.id,
            fromAmount: String(t.fromAmount),
            toAmount: t.toAmount != null ? String(t.toAmount) : '',
            bonusAmount: String(t.bonusAmount),
          }))
        : [emptyTier()]
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function setTierField(id: number, field: keyof Omit<Tier, 'id'>, value: string) {
    setTiers((ts) => ts.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    setSaved(false);
  }

  function addTier() {
    setTiers((ts) => [...ts, emptyTier()]);
  }

  function removeTier(id: number) {
    setTiers((ts) => ts.filter((t) => t.id !== id));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const payload = tiers
      .filter((t) => t.fromAmount !== '' && t.bonusAmount !== '')
      .map((t) => ({
        fromAmount: parseFloat(t.fromAmount),
        toAmount: t.toAmount !== '' ? parseFloat(t.toAmount) : null,
        bonusAmount: parseFloat(t.bonusAmount),
      }))
      .sort((a, b) => a.fromAmount - b.fromAmount);

    setSaving(true);
    const res = await fetch('/api/office-premium-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiers: payload }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Ошибка сохранения');
      return;
    }

    setSaved(true);
    await load();
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) {
    return <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.push('/settings')} className="text-sm text-gray-400 hover:text-gray-600">
          ← Настройки
        </button>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-1">Премия офиса</h1>
      <p className="text-sm text-gray-500 mb-6">
        Таблица диапазонов суммарной выручки <strong>всех аптек</strong> за месяц → премия офисного
        сотрудника. Премия каждого диапазона фиксированная (не накопительная) и начисляется
        каждому офисному сотруднику целиком, без деления на всех. Последнюю строку можно оставить
        без поля «До» — тогда она действует «свыше …» без верхней границы.
      </p>

      {saved && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
          Сохранено.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={save} className="card p-6 space-y-4">
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 text-xs font-medium text-gray-500">
          <span>От (₸)</span>
          <span>До (₸, необязательно)</span>
          <span>Премия (₸)</span>
          <span></span>
        </div>

        {tiers.map((t) => (
          <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-center">
            <input
              type="number" className="input" min="0" step="1" placeholder="130000000"
              value={t.fromAmount}
              onChange={(e) => setTierField(t.id, 'fromAmount', e.target.value)}
            />
            <input
              type="number" className="input" min="0" step="1" placeholder="без границы"
              value={t.toAmount}
              onChange={(e) => setTierField(t.id, 'toAmount', e.target.value)}
            />
            <input
              type="number" className="input" min="0" step="1" placeholder="10000"
              value={t.bonusAmount}
              onChange={(e) => setTierField(t.id, 'bonusAmount', e.target.value)}
            />
            <button
              type="button"
              onClick={() => removeTier(t.id)}
              className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" onClick={addTier} className="text-sm text-blue-600 hover:underline">
          + Добавить диапазон
        </button>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/settings')}>
            Назад
          </button>
        </div>
      </form>
    </div>
  );
}
