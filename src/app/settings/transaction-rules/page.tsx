'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BANK_IMPORT_TARGET_FIELDS, monthlyFieldLabel } from '@/lib/monthly-report-fields';

interface Pharmacy {
  id: number;
  name: string;
}

interface Rule {
  id: number;
  name: string;
  sourceField: string;
  pattern: string;
  matchType: string;
  targetFieldKey: string | null;
  targetFieldLabel: string | null;
  distributionType: string;
  pharmacyId: number | null;
  priority: number;
  isActive: boolean;
  pharmacy: Pharmacy | null;
}

interface RuleForm {
  name: string;
  sourceField: string;
  pattern: string;
  matchType: string;
  targetFieldKey: string;
  distributionType: string;
  pharmacyId: string;
  priority: string;
  isActive: boolean;
}

const SOURCE_FIELDS = [
  ['purpose', 'Назначение платежа'],
  ['counterparty', 'Контрагент / ИП'],
  ['bin_iin', 'ИИН / БИН'],
  ['any_text', 'Везде'],
];

const MATCH_TYPES = [
  ['contains', 'Содержит'],
  ['exact', 'Точное совпадение'],
  ['regex', 'Regex'],
];

const DISTRIBUTIONS = [
  ['specific_pharmacy', 'Конкретная аптека'],
  ['detect_pharmacy_from_text', 'Определять аптеку по тексту'],
  ['split_equally', 'Разделить между всеми активными аптеками'],
];

const emptyForm: RuleForm = {
  name: '',
  sourceField: 'any_text',
  pattern: '',
  matchType: 'contains',
  targetFieldKey: '',
  distributionType: 'detect_pharmacy_from_text',
  pharmacyId: '',
  priority: '0',
  isActive: true,
};

export default function TransactionRulesSettingsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    const [rulesRes, pharmacyRes] = await Promise.all([
      fetch('/api/transaction-import-rules'),
      fetch('/api/pharmacies'),
    ]);
    setRules(await rulesRes.json());
    setPharmacies(await pharmacyRes.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(rule: Rule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      sourceField: rule.sourceField,
      pattern: rule.pattern,
      matchType: rule.matchType,
      targetFieldKey: rule.targetFieldKey ?? '',
      distributionType: rule.distributionType,
      pharmacyId: rule.pharmacyId ? String(rule.pharmacyId) : '',
      priority: String(rule.priority ?? 0),
      isActive: rule.isActive,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...form,
      targetFieldKey: form.targetFieldKey || null,
      pharmacyId: form.distributionType === 'specific_pharmacy' ? form.pharmacyId || null : null,
      priority: Number(form.priority || 0),
    };

    await fetch(editingId ? `/api/transaction-import-rules/${editingId}` : '/api/transaction-import-rules', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    resetForm();
    load();
  }

  async function toggle(rule: Rule) {
    await fetch(`/api/transaction-import-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    load();
  }

  async function remove(rule: Rule) {
    if (!confirm(`Удалить правило «${rule.name}»?`)) return;

    const res = await fetch(`/api/transaction-import-rules/${rule.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Не удалось удалить правило');
      return;
    }

    if (editingId === rule.id) resetForm();
    load();
  }

  function set<K extends keyof RuleForm>(key: K, value: RuleForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-5">
        <Link href="/settings" className="hover:text-slate-600">Настройки</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">Правила транзакций</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-900 mb-1">Правила транзакций</h1>
      <p className="text-sm text-slate-500 mb-4">
        Правила определяют поле отчёта, аптеку и способ распределения банковской строки.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <form onSubmit={save} className="card p-4 space-y-3 h-fit">
          <h2 className="font-semibold text-slate-800">{editingId ? 'Редактировать правило' : 'Создать правило'}</h2>

          <div>
            <label className="label">Название правила</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Где искать</label>
              <select className="input" value={form.sourceField} onChange={(e) => set('sourceField', e.target.value)}>
                {SOURCE_FIELDS.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Тип совпадения</label>
              <select className="input" value={form.matchType} onChange={(e) => set('matchType', e.target.value)}>
                {MATCH_TYPES.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Что искать</label>
            <input className="input" value={form.pattern} onChange={(e) => set('pattern', e.target.value)} required />
          </div>

          <div>
            <label className="label">Тип распределения</label>
            <select className="input" value={form.distributionType} onChange={(e) => set('distributionType', e.target.value)}>
              {DISTRIBUTIONS.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Поле отчёта</label>
            <select className="input" value={form.targetFieldKey} onChange={(e) => set('targetFieldKey', e.target.value)}>
              <option value="">— выбрать —</option>
              {BANK_IMPORT_TARGET_FIELDS.map((field) => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
          </div>

          {form.distributionType === 'specific_pharmacy' && (
            <div>
              <label className="label">Аптека</label>
              <select className="input" value={form.pharmacyId} onChange={(e) => set('pharmacyId', e.target.value)} required>
                <option value="">— выбрать —</option>
                {pharmacies.map((pharmacy) => (
                  <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Приоритет</label>
              <input className="input" type="number" value={form.priority} onChange={(e) => set('priority', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 mt-7">
              <input
                type="checkbox"
                className="w-4 h-4 accent-slate-700"
                checked={form.isActive}
                onChange={(e) => set('isActive', e.target.checked)}
              />
              Активно
            </label>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary" type="submit">{editingId ? 'Сохранить' : 'Создать'}</button>
            {editingId && <button className="btn-secondary" type="button" onClick={resetForm}>Отмена</button>}
          </div>
        </form>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Правило</th>
                  <th className="th">Поиск</th>
                  <th className="th">Поле</th>
                  <th className="th">Распределение</th>
                  <th className="th">Приоритет</th>
                  <th className="th">Статус</th>
                  <th className="th">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{rule.name}</td>
                    <td className="td">
                      <div className="text-xs text-slate-500">
                        {SOURCE_FIELDS.find(([key]) => key === rule.sourceField)?.[1] ?? rule.sourceField} ·{' '}
                        {MATCH_TYPES.find(([key]) => key === rule.matchType)?.[1] ?? rule.matchType}
                      </div>
                      <div className="text-sm text-slate-800">{rule.pattern}</div>
                    </td>
                    <td className="td text-slate-600">
                      {rule.targetFieldLabel ?? monthlyFieldLabel(rule.targetFieldKey)}
                    </td>
                    <td className="td text-slate-600">
                      {DISTRIBUTIONS.find(([key]) => key === rule.distributionType)?.[1] ?? rule.distributionType}
                      {rule.pharmacy && <div className="text-xs text-slate-400">{rule.pharmacy.name}</div>}
                    </td>
                    <td className="td">{rule.priority}</td>
                    <td className="td">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${rule.isActive ? 'bg-green-50 text-green-800 border-green-300' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>
                        {rule.isActive ? 'Активно' : 'Неактивно'}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex gap-2">
                        <button className="btn-secondary text-xs" onClick={() => startEdit(rule)}>Изменить</button>
                        <button className="btn-secondary text-xs" onClick={() => toggle(rule)}>
                          {rule.isActive ? 'Отключить' : 'Включить'}
                        </button>
                        <button className="btn-danger text-xs" onClick={() => remove(rule)}>Удалить</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
