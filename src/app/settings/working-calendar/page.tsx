'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

interface CalendarEntry {
  month: number;
  workingDays: number;
}

export default function WorkingCalendarPage() {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [entries, setEntries] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedMonths, setSavedMonths] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/working-calendar?year=${year}`);
    const data: CalendarEntry[] = await res.json();
    const map: Record<number, number> = {};
    for (const e of data) map[e.month] = e.workingDays;
    setEntries(map);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  async function saveMonth(month: number) {
    const days = entries[month];
    if (!days || days < 1 || days > 31) return;
    setSaving(month);
    await fetch('/api/working-calendar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, workingDays: days }),
    });
    setSaving(null);
    setSavedMonths((s) => new Set(s).add(month));
    setTimeout(() => setSavedMonths((s) => { const n = new Set(s); n.delete(month); return n; }), 2000);
  }

  function handleChange(month: number, value: string) {
    const n = value === '' ? 0 : parseInt(value, 10);
    setEntries((prev) => ({ ...prev, [month]: isNaN(n) ? 0 : n }));
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={() => router.push('/settings')}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← Настройки
        </button>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-1">Производственный календарь</h1>
      <p className="text-sm text-gray-500 mb-6">
        Количество рабочих дней по месяцам — используется при расчёте зарплаты для смены <strong>Пятидневная</strong>.<br />
        Формула: оклад ÷ рабочие дни в месяце × отработанные дни.
      </p>

      <div className="card p-4 mb-4">
        <div className="flex items-center gap-3">
          <label className="label mb-0 shrink-0">Год</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min="2020"
            max="2100"
            className="input w-28"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {MONTHS.map((name, i) => {
            const month = i + 1;
            const days = entries[month] ?? '';
            const isSaving = saving === month;
            const isSaved = savedMonths.has(month);
            return (
              <div key={month} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-sm text-gray-700 w-24 shrink-0">{name}</span>
                <input
                  type="number"
                  value={days}
                  onChange={(e) => handleChange(month, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveMonth(month)}
                  min="1"
                  max="31"
                  placeholder="—"
                  className="input w-20 text-center"
                />
                <span className="text-xs text-gray-400 shrink-0">раб. дней</span>
                <button
                  onClick={() => saveMonth(month)}
                  disabled={isSaving || !entries[month]}
                  className="btn-primary text-xs ml-auto shrink-0"
                >
                  {isSaving ? '...' : isSaved ? 'Сохранено' : 'Сохранить'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
