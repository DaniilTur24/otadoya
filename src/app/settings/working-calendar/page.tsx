'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SalaryImpactDialog } from '@/components/SalaryImpactDialog';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

interface CalendarEntry {
  month: number;
  workingDays: number;
}

interface ImpactMonth {
  year: number;
  month: number;
  shifts: number;
  attendance: number;
  isClosed: boolean;
}

export default function WorkingCalendarPage() {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [entries, setEntries] = useState<Record<number, number>>({});
  // Значения на момент загрузки — по ним определяем, изменилось ли число рабочих дней
  const [originalEntries, setOriginalEntries] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedMonths, setSavedMonths] = useState<Set<number>>(new Set());
  const [pendingMonth, setPendingMonth] = useState<number | null>(null);
  const [impactMonths, setImpactMonths] = useState<ImpactMonth[] | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/working-calendar?year=${year}`);
    const data: CalendarEntry[] = await res.json();
    const map: Record<number, number> = {};
    for (const e of data) map[e.month] = e.workingDays;
    setEntries(map);
    setOriginalEntries(map);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  /**
   * Сколько отметок табеля уже стоит в этом месяце — именно они делятся на число рабочих
   * дней, поэтому их количество показывает реальный масштаб пересчёта.
   */
  async function loadImpact(month: number) {
    setImpactLoading(true);
    setImpactMonths(null);
    try {
      const [shifts, closed] = await Promise.all([
        fetch(`/api/attendance?year=${year}&month=${month}`).then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/months/close?year=${year}&month=${month}`)
          .then((r) => (r.ok ? r.json() : { isClosed: false }))
          .catch(() => ({ isClosed: false })),
      ]);
      setImpactMonths([
        { year, month, shifts: 0, attendance: Array.isArray(shifts) ? shifts.length : 0, isClosed: closed.isClosed === true },
      ]);
    } finally {
      setImpactLoading(false);
    }
  }

  function saveMonth(month: number) {
    const days = entries[month];
    if (!days || days < 1 || days > 31) return;
    // Первое заполнение пустого месяца ничего не пересчитывает — до этого зарплата
    // за пятидневку вообще не начислялась (делителя не было).
    if (originalEntries[month] !== undefined && originalEntries[month] !== days) {
      setPendingMonth(month);
      loadImpact(month);
      return;
    }
    doSaveMonth(month);
  }

  async function doSaveMonth(month: number) {
    const days = entries[month];
    if (!days || days < 1 || days > 31) return;
    setPendingMonth(null);
    setImpactMonths(null);
    setSaving(month);
    await fetch('/api/working-calendar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, workingDays: days }),
    });
    setSaving(null);
    setOriginalEntries((prev) => ({ ...prev, [month]: days }));
    setSavedMonths((s) => new Set(s).add(month));
    setTimeout(() => setSavedMonths((s) => { const n = new Set(s); n.delete(month); return n; }), 2000);
  }

  function handleChange(month: number, value: string) {
    const n = value === '' ? 0 : parseInt(value, 10);
    setEntries((prev) => ({ ...prev, [month]: isNaN(n) ? 0 : n }));
  }

  return (
    <div className="max-w-screen-md">
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={() => router.push('/settings')}
          className="text-sm text-slate-400 hover:text-slate-600"
        >
          ← Настройки
        </button>
      </div>

      <h1 className="text-lg font-semibold text-slate-900 mb-1">Производственный календарь</h1>
      <p className="text-sm text-slate-500 mb-4">
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
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {MONTHS.map((name, i) => {
            const month = i + 1;
            const days = entries[month] ?? '';
            const isSaving = saving === month;
            const isSaved = savedMonths.has(month);
            return (
              <div key={month} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-sm text-slate-700 w-24 shrink-0">{name}</span>
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
                <span className="text-xs text-slate-400 shrink-0">раб. дней</span>
                <button
                  onClick={() => saveMonth(month)}
                  disabled={isSaving || !entries[month]}
                  className="btn-primary text-xs ml-auto shrink-0"
                >
                  {isSaving && <span className="spinner" />}{isSaving ? 'Сохранение' : isSaved ? 'Сохранено' : 'Сохранить'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <SalaryImpactDialog
        open={pendingMonth !== null}
        title="Изменение рабочих дней пересчитает зарплату за этот месяц"
        description={
          'Оклад за пятидневку делится на число рабочих дней месяца. Изменив его, вы измените ' +
          'сумму за каждый отработанный день у всех табельных и пятидневных сотрудников.'
        }
        changedFields={
          pendingMonth !== null
            ? [`Рабочих дней в ${MONTHS[pendingMonth - 1].toLowerCase()} ${year}: ` +
               `${originalEntries[pendingMonth]} → ${entries[pendingMonth]}`]
            : []
        }
        months={impactMonths}
        loading={impactLoading}
        onConfirm={() => pendingMonth !== null && doSaveMonth(pendingMonth)}
        onCancel={() => { setPendingMonth(null); setImpactMonths(null); }}
      />
    </div>
  );
}
