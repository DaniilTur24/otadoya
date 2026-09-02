'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AmountInput } from '@/components/AmountInput';
import { SalaryImpactDialog, type ImpactMonth } from '@/components/SalaryImpactDialog';
import { useSalaryImpact } from '@/hooks/useSalaryImpact';

interface ImpactEmployee { id: number; name: string; employeeType: string }
interface PharmacyImpact {
  months: ImpactMonth[];
  totalRecords: number;
  ladderEmployees: ImpactEmployee[];
  shiftEmployees: ImpactEmployee[];
}

interface Pharmacy {
  id: number;
  name: string;
  isActive: boolean;
  keywords: string;
  managerPremiumThreshold: number | null;
  managerPremiumBase: number | null;
  managerPremiumStepAmount: number | null;
  managerPremiumStepBonus: number | null;
  poolAverageRevenuePremium: boolean;
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
  // Непустой список = открыт диалог с предупреждением о пересчёте задним числом
  const [pendingFields, setPendingFields] = useState<string[]>([]);
  const impact = useSalaryImpact<PharmacyImpact>();

  const [form, setForm] = useState({
    name: '',
    isActive: true,
    keywords: '',
    managerPremiumThreshold: '',
    managerPremiumBase: '',
    managerPremiumStepAmount: '',
    managerPremiumStepBonus: '',
    poolAverageRevenuePremium: false,
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
          managerPremiumThreshold:  p.managerPremiumThreshold != null ? String(p.managerPremiumThreshold) : '',
          managerPremiumBase:       p.managerPremiumBase != null ? String(p.managerPremiumBase) : '',
          managerPremiumStepAmount: p.managerPremiumStepAmount != null ? String(p.managerPremiumStepAmount) : '',
          managerPremiumStepBonus:  p.managerPremiumStepBonus != null ? String(p.managerPremiumStepBonus) : '',
          poolAverageRevenuePremium: p.poolAverageRevenuePremium ?? false,
        });
        setLoading(false);
      });
  }, [id]);

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  /**
   * Пороги премии и переключатель средней выручки применяются к любому месяцу, который
   * система считает, — включая уже отработанные. Предупреждаем только если эти поля
   * реально изменились: правка названия или ключевых слов на зарплату не влияет.
   */
  function changedSalaryFields(): string[] {
    if (!original) return [];
    const money = (v: string) => (v === '' ? '—' : Number(v).toLocaleString('ru-RU'));
    const asStr = (n: number | null) => (n != null ? String(n) : '');
    const changed: string[] = [];

    const ladderFields: { key: keyof typeof form; original: number | null; label: string }[] = [
      { key: 'managerPremiumThreshold',  original: original.managerPremiumThreshold,  label: 'Порог премии' },
      { key: 'managerPremiumBase',       original: original.managerPremiumBase,       label: 'Базовая премия' },
      { key: 'managerPremiumStepAmount', original: original.managerPremiumStepAmount, label: 'Шаг выручки' },
      { key: 'managerPremiumStepBonus',  original: original.managerPremiumStepBonus,  label: 'Премия за шаг' },
    ];
    for (const f of ladderFields) {
      const next = String(form[f.key] ?? '');
      if (next !== asStr(f.original)) {
        changed.push(`${f.label}: ${money(asStr(f.original))} → ${money(next)} ₸`);
      }
    }

    if (form.poolAverageRevenuePremium !== original.poolAverageRevenuePremium) {
      changed.push(
        form.poolAverageRevenuePremium
          ? 'Премия от средней выручки аптеки: включается (вместо личной выручки каждой смены)'
          : 'Премия от средней выручки аптеки: выключается (вернётся расчёт по личной выручке)'
      );
    }
    return changed;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Название обязательно'); return; }
    const changed = changedSalaryFields();
    if (changed.length > 0) {
      setPendingFields(changed);
      impact.load(`/api/pharmacies/${id}/salary-impact`);
      return;
    }
    doSave();
  }

  async function doSave() {
    setPendingFields([]);
    impact.reset();
    setSaving(true);
    setError('');

    const res = await fetch(`/api/pharmacies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        form.name.trim(),
        isActive:    form.isActive,
        keywords:    form.keywords.trim(),
        managerPremiumThreshold:  form.managerPremiumThreshold ? parseFloat(form.managerPremiumThreshold) : null,
        managerPremiumBase:       form.managerPremiumBase ? parseFloat(form.managerPremiumBase) : null,
        managerPremiumStepAmount: form.managerPremiumStepAmount ? parseFloat(form.managerPremiumStepAmount) : null,
        managerPremiumStepBonus:  form.managerPremiumStepBonus ? parseFloat(form.managerPremiumStepBonus) : null,
        poolAverageRevenuePremium: form.poolAverageRevenuePremium,
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
    return (
      <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
        <span className="spinner" /> Загрузка...
      </div>
    );
  }

  return (
    <div className="max-w-screen-md">
      {/* Навигация */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-5">
        <Link href="/settings" className="hover:text-slate-600">Настройки</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">{original?.name}</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-900 mb-1">{original?.name}</h1>
      <p className="text-sm text-slate-500 mb-4">
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

      <form onSubmit={save} className="card p-4 space-y-3">
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

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="w-4 h-4 accent-slate-700"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          Активна
        </label>

        {/* Ключевые слова */}
        <div>
          <label className="label">
            Старые ключевые слова для авто-привязки
            <span className="ml-1 text-slate-400 font-normal text-xs">(через запятую)</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="например: сункар, хисамутдинов, ул. Сункарова"
            value={form.keywords}
            onChange={(e) => set('keywords', e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">
            Для нового банковского импорта используйте страницу «Алиасы аптек».
          </p>
        </div>

        {/* Заведующие: лестница премии */}
        <div className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Премия заведующих этой аптеки</h2>
          <p className="text-xs text-slate-400 mb-3">
            Применяется и к торгующей, и к не торгующей заведующей одинаково. Лестница: при выручке аптеки
            за месяц от «порога» выдаётся «премия за порог», далее за каждые «шаг выручки» сверху добавляется «шаг премии».
            Фиксированная доплата сотруднику теперь настраивается в его карточке (раздел «Сотрудники» / «Заведующие и менеджеры»),
            а не здесь.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Порог выручки для премии (₸)</label>
              <AmountInput
                className="input"
                placeholder="400000"
                value={form.managerPremiumThreshold}
                onChange={(value) => set('managerPremiumThreshold', value)}
              />
            </div>
            <div>
              <label className="label">Премия за порог (₸)</label>
              <AmountInput
                className="input"
                placeholder="10000"
                value={form.managerPremiumBase}
                onChange={(value) => set('managerPremiumBase', value)}
              />
            </div>
            <div>
              <label className="label">Шаг выручки (₸)</label>
              <AmountInput
                className="input"
                placeholder="50000"
                value={form.managerPremiumStepAmount}
                onChange={(value) => set('managerPremiumStepAmount', value)}
              />
            </div>
            <div>
              <label className="label">Прибавка премии за шаг (₸)</label>
              <AmountInput
                className="input"
                placeholder="5000"
                value={form.managerPremiumStepBonus}
                onChange={(value) => set('managerPremiumStepBonus', value)}
              />
            </div>
          </div>
        </div>

        {/* Премия за смену: личная или средняя по аптеке */}
        <div className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Премия за смену (продавцы и торгующая заведующая)</h2>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="w-4 h-4 accent-slate-700"
              checked={form.poolAverageRevenuePremium}
              onChange={(e) => set('poolAverageRevenuePremium', e.target.checked)}
            />
            Премия по средней выручке аптеки за смену (не по личной выручке сотрудника)
          </label>
          <p className="text-xs text-slate-400 mt-1">
            По умолчанию премия (1,5% сверх порога 200 000 ₸ за смену «день» и 300 000 ₸ за «сутки») считается
            от личной выручки каждого сотрудника за его смену. Если включить эту галочку — вместо личной выручки
            берётся средняя выручка аптеки за смену того же типа за месяц (сумма выручки всех смен «день» этого месяца,
            делённая на их количество; отдельно то же самое для «сутки»), и по ней считается такая же премия — поровну
            на смену, независимо от того, кто именно её отработал.
          </p>
        </div>

        {/* Кнопки */}
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <span className="spinner" />}{saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/settings')}>
            Назад к списку
          </button>
        </div>
      </form>

      <SalaryImpactDialog
        open={pendingFields.length > 0}
        title="Изменение пересчитает зарплату сотрудников аптеки"
        description={
          `Премии аптеки «${original?.name ?? ''}» считаются заново при каждом открытии отчёта, ` +
          'из текущих настроек. Новые значения применятся и к уже отработанным месяцам.'
        }
        changedFields={pendingFields}
        months={impact.data?.months ?? null}
        loading={impact.loading}
        extra={(() => {
          const affected = form.poolAverageRevenuePremium !== original?.poolAverageRevenuePremium
            ? [...(impact.data?.ladderEmployees ?? []), ...(impact.data?.shiftEmployees ?? [])]
            : (impact.data?.ladderEmployees ?? []);
          const unique = [...new Map(affected.map((e) => [e.id, e])).values()];
          if (unique.length === 0) return null;
          return (
            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="label mb-1.5">Кого затронет ({unique.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {unique.map((e) => (
                  <span key={e.id} className="text-xs bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-700">
                    {e.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
        onConfirm={doSave}
        onCancel={() => { setPendingFields([]); impact.reset(); }}
      />
    </div>
  );
}
