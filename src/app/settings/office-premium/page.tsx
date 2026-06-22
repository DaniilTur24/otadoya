'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface OfficePremiumSettings {
  threshold: number;
  base: number;
  stepAmount: number;
  stepBonus: number;
}

export default function OfficePremiumSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ threshold: '', base: '', stepAmount: '', stepBonus: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const data: OfficePremiumSettings = await fetch('/api/office-premium-settings').then((r) => r.json());
    setForm({
      threshold: data.threshold ? String(data.threshold) : '',
      base: data.base ? String(data.base) : '',
      stepAmount: data.stepAmount ? String(data.stepAmount) : '',
      stepBonus: data.stepBonus ? String(data.stepBonus) : '',
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/office-premium-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threshold: form.threshold ? parseFloat(form.threshold) : 0,
        base: form.base ? parseFloat(form.base) : 0,
        stepAmount: form.stepAmount ? parseFloat(form.stepAmount) : 0,
        stepBonus: form.stepBonus ? parseFloat(form.stepBonus) : 0,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) {
    return <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>;
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.push('/settings')} className="text-sm text-gray-400 hover:text-gray-600">
          ← Настройки
        </button>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-1">Премия офиса</h1>
      <p className="text-sm text-gray-500 mb-6">
        Единая лестница премии для офисных сотрудников от суммарной выручки <strong>всех аптек</strong> за месяц.
        При выручке от «порога» выдаётся «премия за порог», далее за каждые «шаг выручки» сверху
        добавляется «шаг премии».
      </p>

      {saved && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
          Сохранено.
        </div>
      )}

      <form onSubmit={save} className="card p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Порог выручки всех аптек (₸)</label>
            <input
              type="number"
              className="input"
              min="0"
              step="1"
              placeholder="1000000"
              value={form.threshold}
              onChange={(e) => set('threshold', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Премия за порог (₸)</label>
            <input
              type="number"
              className="input"
              min="0"
              step="1"
              placeholder="20000"
              value={form.base}
              onChange={(e) => set('base', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Шаг выручки (₸)</label>
            <input
              type="number"
              className="input"
              min="0"
              step="1"
              placeholder="100000"
              value={form.stepAmount}
              onChange={(e) => set('stepAmount', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Прибавка премии за шаг (₸)</label>
            <input
              type="number"
              className="input"
              min="0"
              step="1"
              placeholder="2000"
              value={form.stepBonus}
              onChange={(e) => set('stepBonus', e.target.value)}
            />
          </div>
        </div>

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
