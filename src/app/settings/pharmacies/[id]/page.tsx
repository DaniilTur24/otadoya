'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
    coefficient: '',
    terminalRent: '',
    procedureRent: '',
  });

  const [terminalOn, setTerminalOn]     = useState(false);
  const [procedureOn, setProcedureOn]   = useState(false);

  useEffect(() => {
    fetch(`/api/pharmacies/${id}`)
      .then((r) => r.json())
      .then((p: Pharmacy) => {
        setOriginal(p);
        setForm({
          name:          p.name,
          isActive:      p.isActive ?? true,
          keywords:      p.keywords ?? '',
          coefficient:   p.coefficient   ? String(p.coefficient)   : '',
          terminalRent:  p.terminalRent  ? String(p.terminalRent)  : '',
          procedureRent: p.procedureRent ? String(p.procedureRent) : '',
        });
        setTerminalOn(Number(p.terminalRent) > 0);
        setProcedureOn(Number(p.procedureRent) > 0);
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
        name:          form.name.trim(),
        isActive:      form.isActive,
        keywords:      form.keywords.trim(),
        coefficient:   form.coefficient   ? parseFloat(form.coefficient)   : 0,
        terminalRent:  terminalOn  && form.terminalRent  ? parseFloat(form.terminalRent)  : 0,
        procedureRent: procedureOn && form.procedureRent ? parseFloat(form.procedureRent) : 0,
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

        {/* Коэффициент */}
        <div>
          <label className="label">
            Коэффициент
            <span className="ml-1 text-gray-400 font-normal text-xs">— используется в закрытии месяца</span>
          </label>
          <input
            type="number"
            className="input max-w-xs"
            placeholder="1.00"
            min="0"
            step="0.01"
            value={form.coefficient}
            onChange={(e) => set('coefficient', e.target.value)}
          />
        </div>

        {/* Фиксированные расходы по аренде */}
        <div>
          <p className="label mb-3">Фиксированные расходы по аренде</p>
          <div className="space-y-3">
            {/* Аренда терминал */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="terminalOn"
                className="w-4 h-4 accent-blue-600 cursor-pointer"
                checked={terminalOn}
                onChange={(e) => {
                  setTerminalOn(e.target.checked);
                  if (!e.target.checked) set('terminalRent', '');
                }}
              />
              <label htmlFor="terminalOn" className="text-sm text-gray-700 cursor-pointer w-40">
                Аренда терминал
              </label>
              {terminalOn && (
                <input
                  type="number"
                  className="input w-40"
                  placeholder="Сумма"
                  min="0"
                  step="0.01"
                  value={form.terminalRent}
                  onChange={(e) => set('terminalRent', e.target.value)}
                />
              )}
            </div>

            {/* Процедурная аренда */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="procedureOn"
                className="w-4 h-4 accent-blue-600 cursor-pointer"
                checked={procedureOn}
                onChange={(e) => {
                  setProcedureOn(e.target.checked);
                  if (!e.target.checked) set('procedureRent', '');
                }}
              />
              <label htmlFor="procedureOn" className="text-sm text-gray-700 cursor-pointer w-40">
                Процедурная аренда
              </label>
              {procedureOn && (
                <input
                  type="number"
                  className="input w-40"
                  placeholder="Сумма"
                  min="0"
                  step="0.01"
                  value={form.procedureRent}
                  onChange={(e) => set('procedureRent', e.target.value)}
                />
              )}
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
