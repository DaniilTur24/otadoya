'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AmountInput } from '@/components/AmountInput';
import { SalaryImpactDialog } from '@/components/SalaryImpactDialog';

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

/** Сравнимый слепок таблицы без id — id у новых строк временные и меняются при каждом добавлении */
function serializeTiers(tiers: Tier[]): string {
  return JSON.stringify(
    tiers
      .filter((t) => t.fromAmount !== '' && t.bonusAmount !== '')
      .map((t) => [t.fromAmount, t.toAmount, t.bonusAmount])
      .sort()
  );
}

export default function OfficePremiumSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [tiers, setTiers] = useState<Tier[]>([]);
  // Слепок таблицы на момент загрузки — по нему определяем, изменились ли ставки премии
  const [originalTiers, setOriginalTiers] = useState('');
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data: { id: number; fromAmount: number; toAmount: number | null; bonusAmount: number }[] =
      await fetch('/api/office-premium-settings').then((r) => r.json());
    const loaded = data.length > 0
      ? data.map((t) => ({
          id: t.id,
          fromAmount: String(t.fromAmount),
          toAmount: t.toAmount != null ? String(t.toAmount) : '',
          bonusAmount: String(t.bonusAmount),
        }))
      : [emptyTier()];
    setTiers(loaded);
    setOriginalTiers(serializeTiers(loaded));
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

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    // Таблица применяется ко ВСЕМ офисным сотрудникам и ко всем месяцам сразу —
    // премия за прошлые месяцы пересчитается по новым ставкам.
    if (serializeTiers(tiers) !== originalTiers) {
      setConfirming(true);
      return;
    }
    doSave();
  }

  async function doSave() {
    setConfirming(false);
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
    return (
      <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
        <span className="spinner" /> Загрузка...
      </div>
    );
  }

  return (
    <div className="max-w-screen-md">
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.push('/settings')} className="text-sm text-slate-400 hover:text-slate-600">
          ← Настройки
        </button>
      </div>

      <h1 className="text-lg font-semibold text-slate-900 mb-1">Премия офиса</h1>
      <p className="text-sm text-slate-500 mb-4">
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

      <form onSubmit={save} className="card p-4 space-y-3">
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 text-xs font-medium text-slate-500">
          <span>От (₸)</span>
          <span>До (₸, необязательно)</span>
          <span>Премия (₸)</span>
          <span></span>
        </div>

        {tiers.map((t) => (
          <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-center">
            <AmountInput
              className="input" placeholder="130000000"
              value={t.fromAmount}
              onChange={(value) => setTierField(t.id, 'fromAmount', value)}
            />
            <AmountInput
              className="input" placeholder="без границы"
              value={t.toAmount}
              onChange={(value) => setTierField(t.id, 'toAmount', value)}
            />
            <AmountInput
              className="input" placeholder="10000"
              value={t.bonusAmount}
              onChange={(value) => setTierField(t.id, 'bonusAmount', value)}
            />
            <button
              type="button"
              onClick={() => removeTier(t.id)}
              className="text-slate-300 hover:text-red-500 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" onClick={addTier} className="text-sm text-slate-700 hover:underline">
          + Добавить диапазон
        </button>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <span className="spinner" />}{saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/settings')}>
            Назад
          </button>
        </div>
      </form>

      <SalaryImpactDialog
        open={confirming}
        title="Изменение пересчитает премию всех офисных сотрудников"
        description={
          'Эта таблица — глобальная: она применяется ко всем сотрудникам с типом «Офис» и ко всем ' +
          'месяцам сразу. Премия за уже отработанные месяцы будет пересчитана по новым ставкам.'
        }
        changedFields={['Таблица премий от общей выручки всех аптек']}
        months={null}
        loading={false}
        extra={
          <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
            Затронет все незакрытые месяцы, где была выручка, — конкретный список здесь не
            показывается, потому что таблица общая для всех аптек и всех периодов.
          </div>
        }
        onConfirm={doSave}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
