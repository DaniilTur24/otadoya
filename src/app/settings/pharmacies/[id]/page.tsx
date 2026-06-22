'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Pharmacy {
  id: number;
  name: string;
  isActive: boolean;
  keywords: string;
  managerAllowance: number;
  managerPremiumThreshold: number | null;
  managerPremiumBase: number | null;
  managerPremiumStepAmount: number | null;
  managerPremiumStepBonus: number | null;
}

export default function PharmacyEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);

  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState('');
  const [original, setOriginal]   = useState<Pharmacy | null>(null);

  const [form, setForm] = useState({
    name: '',
    isActive: true,
    keywords: '',
    managerAllowance: '',
    managerPremiumThreshold: '',
    managerPremiumBase: '',
    managerPremiumStepAmount: '',
    managerPremiumStepBonus: '',
  });

  useEffect(() => {
    fetch(`/api/pharmacies/${id}`)
      .then((r) => r.json())
      .then((p: Pharmacy) => {
        setOriginal(p);
        setForm({
          name:        p.name,
          isActive:    p.isActive ?? true,
          keywords:    p.keywords ?? '',
          managerAllowance:         p.managerAllowance ? String(p.managerAllowance) : '',
          managerPremiumThreshold:  p.managerPremiumThreshold != null ? String(p.managerPremiumThreshold) : '',
          managerPremiumBase:       p.managerPremiumBase != null ? String(p.managerPremiumBase) : '',
          managerPremiumStepAmount: p.managerPremiumStepAmount != null ? String(p.managerPremiumStepAmount) : '',
          managerPremiumStepBonus:  p.managerPremiumStepBonus != null ? String(p.managerPremiumStepBonus) : '',
        });
        setLoading(false);
      });
  }, [id]);

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Название обязательно'); return; }
    setSaving(true);
    setError('');

    const res = await fetch(`/api/pharmacies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        form.name.trim(),
        isActive:    form.isActive,
        keywords:    form.keywords.trim(),
        managerAllowance:         form.managerAllowance ? parseFloat(form.managerAllowance) : 0,
        managerPremiumThreshold:  form.managerPremiumThreshold ? parseFloat(form.managerPremiumThreshold) : null,
        managerPremiumBase:       form.managerPremiumBase ? parseFloat(form.managerPremiumBase) : null,
        managerPremiumStepAmount: form.managerPremiumStepAmount ? parseFloat(form.managerPremiumStepAmount) : null,
        managerPremiumStepBonus:  form.managerPremiumStepBonus ? parseFloat(form.managerPremiumStepBonus) : null,
      }),
    });

    if (res.ok) {
      const updated: Pharmacy = await res.json();
      setOriginal(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError('Ошибка сохранения');
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>;
  }

  return (
    <div className="max-w-xl">
      {/* Навигация */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-5">
        <Link href="/settings" className="hover:text-gray-600">Настройки</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{original?.name}</span>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-1">{original?.name}</h1>
      <p className="text-sm text-gray-500 mb-6">
        Редактирование параметров аптеки.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
          Сохранено.
        </div>
      )}

      <form onSubmit={save} className="card p-6 space-y-5">
        {/* Название */}
        <div>
          <label className="label">Название аптеки *</label>
          <input
            type="text"
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="w-4 h-4 accent-blue-600"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          Активна
        </label>

        {/* Ключевые слова */}
        <div>
          <label className="label">
            Старые ключевые слова для авто-привязки
            <span className="ml-1 text-gray-400 font-normal text-xs">(через запятую)</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="например: сункар, хисамутдинов, ул. Сункарова"
            value={form.keywords}
            onChange={(e) => set('keywords', e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            Для нового банковского импорта используйте страницу «Алиасы аптек».
          </p>
        </div>

        {/* Заведующие: доплата и лестница премии */}
        <div className="border-t border-gray-100 pt-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Премия заведующих этой аптеки</h2>
          <p className="text-xs text-gray-400 mb-3">
            Применяется и к торгующей, и к не торгующей заведующей одинаково. Лестница: при выручке аптеки
            за месяц от «порога» выдаётся «премия за порог», далее за каждые «шаг выручки» сверху добавляется «шаг премии».
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Доплата за аптеку (₸/мес)</label>
              <input
                type="number"
                className="input"
                min="0"
                step="1"
                value={form.managerAllowance}
                onChange={(e) => set('managerAllowance', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Порог выручки для премии (₸)</label>
              <input
                type="number"
                className="input"
                min="0"
                step="1"
                placeholder="400000"
                value={form.managerPremiumThreshold}
                onChange={(e) => set('managerPremiumThreshold', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Премия за порог (₸)</label>
              <input
                type="number"
                className="input"
                min="0"
                step="1"
                placeholder="10000"
                value={form.managerPremiumBase}
                onChange={(e) => set('managerPremiumBase', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Шаг выручки (₸)</label>
              <input
                type="number"
                className="input"
                min="0"
                step="1"
                placeholder="50000"
                value={form.managerPremiumStepAmount}
                onChange={(e) => set('managerPremiumStepAmount', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Прибавка премии за шаг (₸)</label>
              <input
                type="number"
                className="input"
                min="0"
                step="1"
                placeholder="5000"
                value={form.managerPremiumStepBonus}
                onChange={(e) => set('managerPremiumStepBonus', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/settings')}>
            Назад к списку
          </button>
        </div>
      </form>
    </div>
  );
}
