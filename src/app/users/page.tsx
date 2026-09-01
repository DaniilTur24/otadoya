'use client';

import { useState, useEffect, useCallback } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { SalaryImpactDialog } from '@/components/SalaryImpactDialog';
import { useSalaryImpact } from '@/hooks/useSalaryImpact';
import {
  WORK_SCHEDULE_LABELS,
  WORK_SCHEDULE_OPTIONS,
  resolveWorkSchedule,
  type WorkSchedule,
} from '@/lib/employee-types';

const MANAGER_TYPE_OPTIONS = [
  { value: 'manager_trading', label: 'Заведующая (торгует)' },
  { value: 'manager_fixed', label: 'Заведующая (не торгует)' },
  { value: 'pharmacy_manager', label: 'Менеджер' },
] as const;

interface Pharmacy { id: number; name: string }
interface Manager {
  id: number;
  /** id карточки Employee — по ней считается зарплата (может быть null у старых аккаунтов) */
  employeeId: number | null;
  username: string;
  displayName: string;
  isActive: boolean;
  baseSalary: number;
  employeeType: string;
  ladderPremiumEnabled: boolean;
  managerBonusShareEnabled: boolean;
  workSchedule: string | null;
  fiveDaySalary: number | null;
  allowance: number;
  allowanceDescription: string;
  pharmacies: Pharmacy[];
  // 'user' — есть логин/пароль (заведующая); 'employee' — менеджер без доступа к системе
  accountType: 'user' | 'employee';
}

export default function UsersPage() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingAccountType, setEditingAccountType] = useState<'user' | 'employee' | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Непустой список = открыт диалог с предупреждением о пересчёте задним числом
  const [pendingFields, setPendingFields] = useState<string[]>([]);
  const impact = useSalaryImpact();

  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    baseSalary: '',
    employeeType: 'manager_trading' as string,
    ladderPremiumEnabled: false,
    managerBonusShareEnabled: true,
    // Пустая строка = график не выбран явно; сервер сохранит NULL и расчёт останется прежним
    workSchedule: '' as string,
    fiveDaySalary: '',
    allowance: '',
    allowanceDescription: '',
    pharmacyIds: [] as number[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [mgrs, pharms] = await Promise.all([
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/pharmacies').then((r) => r.json()),
    ]);
    setManagers(mgrs);
    setPharmacies(pharms);
    setSelectedIds(new Set());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({
      username: '', password: '', displayName: '', baseSalary: '',
      employeeType: 'manager_trading', ladderPremiumEnabled: false, managerBonusShareEnabled: true,
      workSchedule: '', fiveDaySalary: '',
      allowance: '', allowanceDescription: '', pharmacyIds: [],
    });
    setEditingId(null);
    setEditingAccountType(null);
    setShowForm(false);
    setError('');
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  function startEdit(m: Manager) {
    setForm({
      username: m.username,
      password: '',
      displayName: m.displayName,
      baseSalary: String(m.baseSalary),
      employeeType: m.employeeType,
      ladderPremiumEnabled: m.ladderPremiumEnabled,
      managerBonusShareEnabled: m.managerBonusShareEnabled,
      // У карточек, созданных до появления графика, workSchedule пустой. Показываем
      // выведенный график, а не пустое поле: иначе админ увидел бы «не выбрано» и мог
      // пересохранить карточку с другой формулой, сам того не заметив.
      workSchedule: m.workSchedule ?? resolveWorkSchedule({ employeeType: m.employeeType }),
      fiveDaySalary: m.fiveDaySalary != null ? String(m.fiveDaySalary) : '',
      allowance: m.allowance ? String(m.allowance) : '',
      allowanceDescription: m.allowanceDescription ?? '',
      pharmacyIds: m.pharmacies.map((p) => p.id),
    });
    setEditingId(m.id);
    setEditingAccountType(m.accountType);
    setShowForm(true);
    setError('');
  }

  function togglePharmacy(id: number) {
    setForm((f) => ({
      ...f,
      pharmacyIds: f.pharmacyIds.includes(id)
        ? f.pharmacyIds.filter((p) => p !== id)
        : [...f.pharmacyIds, id],
    }));
  }

  /**
   * Какие из изменённых полей пересчитают зарплату за уже отработанные месяцы.
   * При создании нового аккаунта список всегда пуст — у него нет прошлого.
   */
  function changedSalaryFields(): string[] {
    if (editingId === null) return [];
    const original = managers.find((m) => m.id === editingId);
    if (!original) return [];

    const money = (n: number) => n.toLocaleString('ru-RU');
    const changed: string[] = [];

    if (form.employeeType !== original.employeeType) {
      const label = (v: string) => MANAGER_TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
      changed.push(`Роль: ${label(original.employeeType)} → ${label(form.employeeType)} (меняется формула расчёта)`);
    }
    if (Number(form.baseSalary || 0) !== Number(original.baseSalary)) {
      changed.push(`Оклад: ${money(Number(original.baseSalary))} → ${money(Number(form.baseSalary || 0))} ₸`);
    }
    if (Number(form.allowance || 0) !== Number(original.allowance ?? 0)) {
      changed.push(`Фиксированная доплата: ${money(Number(original.allowance ?? 0))} → ${money(Number(form.allowance || 0))} ₸`);
    }
    if (form.managerBonusShareEnabled !== original.managerBonusShareEnabled) {
      changed.push(
        form.managerBonusShareEnabled
          ? '10% от бонусов аптеки: включается'
          : '10% от бонусов аптеки: выключается'
      );
    }
    const originalSchedule = original.workSchedule ?? resolveWorkSchedule({ employeeType: original.employeeType });
    if (form.workSchedule && form.workSchedule !== originalSchedule) {
      const label = (v: string) => WORK_SCHEDULE_LABELS[v as WorkSchedule] ?? v;
      changed.push(`График работы: ${label(originalSchedule)} → ${label(form.workSchedule)} (меняется источник отработанных дней)`);
    }
    if (Number(form.fiveDaySalary || 0) !== Number(original.fiveDaySalary ?? 0)) {
      changed.push(`Оклад за пятидневку: ${money(Number(original.fiveDaySalary ?? 0))} → ${money(Number(form.fiveDaySalary || 0))} ₸`);
    }
    if (form.ladderPremiumEnabled !== original.ladderPremiumEnabled) {
      changed.push(
        form.ladderPremiumEnabled
          ? 'Лестничная премия по выручке аптеки: включается'
          : 'Лестничная премия по выручке аптеки: выключается'
      );
    }
    return changed;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const changed = changedSalaryFields();
    if (changed.length > 0) {
      const original = managers.find((m) => m.id === editingId);
      setPendingFields(changed);
      // У старых аккаунтов без карточки Employee считать нечего — диалог покажется без списка месяцев
      if (original?.employeeId) impact.load(`/api/employees/${original.employeeId}/salary-impact`);
      return;
    }
    doSubmit();
  }

  async function doSubmit() {
    setPendingFields([]);
    impact.reset();
    setError('');
    setSaving(true);

    const body: Record<string, unknown> = {
      displayName: form.displayName,
      pharmacyIds: form.pharmacyIds,
      baseSalary: form.baseSalary || 0,
      employeeType: form.employeeType,
      ladderPremiumEnabled: form.ladderPremiumEnabled,
      managerBonusShareEnabled: form.managerBonusShareEnabled,
      allowance: form.allowance || 0,
      allowanceDescription: form.allowanceDescription.trim(),
      workSchedule: form.workSchedule || null,
      // Второй оклад имеет смысл только при смешанном графике — в остальных случаях
      // очищаем его, чтобы он не «выстрелил» при последующей смене графика.
      fiveDaySalary: form.workSchedule === 'mixed' ? form.fiveDaySalary || null : null,
    };

    const needsLogin = form.employeeType !== 'pharmacy_manager';

    let res: Response;
    if (editingId !== null) {
      if (needsLogin && form.password) body.password = form.password;
      res = await fetch(`/api/users/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      if (needsLogin) {
        body.username = form.username;
        body.password = form.password;
      }
      res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    if (res.ok) {
      setSuccess(editingId !== null ? 'Изменения сохранены' : 'Аккаунт создан');
      setTimeout(() => setSuccess(''), 3000);
      resetForm();
      load();
    } else {
      const d = await res.json();
      setError(d.error || 'Ошибка сохранения');
    }
    setSaving(false);
  }

  async function deleteManager(id: number) {
    if (!confirm('Удалить аккаунт? Записи выручки и табеля останутся.')) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    load();
  }

  function toggleSelect(id: number) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((s) =>
      s.size === managers.length ? new Set() : new Set(managers.map((m) => m.id))
    );
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} выбранных аккаунтов? Записи выручки и табеля останутся.`)) return;
    await Promise.all(
      Array.from(selectedIds).map((id) => fetch(`/api/users/${id}`, { method: 'DELETE' }))
    );
    load();
  }

  return (
    <div className="max-w-screen-xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-900">Заведующие и менеджеры</h1>
        <button className="btn-primary text-sm" onClick={startCreate}>+ Добавить</button>
      </div>
      <p className="text-slate-500 text-sm mb-4">
        Управление аккаунтами заведующих и менеджеров аптек. Каждый видит только свои аптеки.
      </p>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-800 text-sm">
          {success}
        </div>
      )}

      {showForm && (
        <div className="card p-4 mb-4 border-slate-400 border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">
              {editingId !== null ? 'Редактирование аккаунта' : 'Новый заведующий / менеджер'}
            </h2>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {form.employeeType !== 'pharmacy_manager' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Логин *</label>
                  <input
                    className="input"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    required={editingId === null}
                    disabled={editingId !== null}
                    placeholder="username"
                  />
                  {editingId !== null && (
                    <p className="text-xs text-slate-400 mt-1">Логин изменить нельзя</p>
                  )}
                </div>
                <div>
                  <label className="label">
                    {editingId !== null ? 'Новый пароль (оставьте пустым — не менять)' : 'Пароль *'}
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required={editingId === null}
                    placeholder="минимум 6 символов"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">Имя для отображения *</label>
              <input
                className="input"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                required
                placeholder="Иванов Иван"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Роль *</label>
                <select
                  className="input"
                  value={form.employeeType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      employeeType: e.target.value,
                      // График подставляется под роль только при создании. При редактировании
                      // он уже отражает то, как человек реально работает, и молча менять его
                      // от смены роли нельзя — это переписало бы формулу за прошлые месяцы.
                      workSchedule:
                        editingId === null
                          ? resolveWorkSchedule({ employeeType: e.target.value })
                          : f.workSchedule,
                    }))
                  }
                >
                  {MANAGER_TYPE_OPTIONS
                    .filter((t) => {
                      if (editingId === null) return true;
                      // Тип нельзя переключить между «есть логин» и «менеджер без логина» —
                      // для такой смены роли нужно удалить и создать заново
                      return editingAccountType === 'employee'
                        ? t.value === 'pharmacy_manager'
                        : t.value !== 'pharmacy_manager';
                    })
                    .map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                </select>
                {editingId !== null && editingAccountType === 'employee' && (
                  <p className="text-xs text-slate-400 mt-1">Менеджера нельзя переключить в заведующие — удалите и создайте заново</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  {form.employeeType === 'pharmacy_manager'
                    ? 'Не получает логин в систему. Доплата и премии — см. чекбоксы ниже'
                    : 'Получает логин в систему. Доплата и премии — см. чекбоксы ниже'}
                </p>
              </div>
              <div>
                <label className="label">График работы *</label>
                <select
                  className="input"
                  value={form.workSchedule}
                  onChange={(e) => setForm((f) => ({ ...f, workSchedule: e.target.value }))}
                >
                  {WORK_SCHEDULE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  {form.workSchedule === 'shift'
                    ? 'Отработанные дни берутся из смен в записях выручки'
                    : form.workSchedule === 'mixed'
                    ? 'Часть дней — смены в записях выручки, часть — отметки в табеле. За каждую часть свой оклад'
                    : 'Отработанные дни берутся из табеля посещаемости'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">
                  {form.workSchedule === 'mixed' ? 'Оклад за смены (₸) *' : 'Оклад (₸) *'}
                </label>
                <AmountInput
                  className="input"
                  value={form.baseSalary}
                  onChange={(value) => setForm((f) => ({ ...f, baseSalary: value }))}
                  placeholder="150000"
                  required
                />
                {form.workSchedule === 'mixed' && (
                  <p className="text-xs text-slate-400 mt-1">Делится на 15 за дневную смену и на 10 за суточную</p>
                )}
              </div>
              {/* Второй оклад нужен только смешанному графику: у остальных пятидневка
                  и так считается от основного оклада. */}
              {form.workSchedule === 'mixed' && (
                <div>
                  <label className="label">Оклад за пятидневку (₸)</label>
                  <AmountInput
                    className="input"
                    value={form.fiveDaySalary}
                    onChange={(value) => setForm((f) => ({ ...f, fiveDaySalary: value }))}
                    placeholder="оставьте пустым — как оклад за смены"
                  />
                  <p className="text-xs text-slate-400 mt-1">Делится на число рабочих дней месяца</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Фиксированная доплата (₸/мес)</label>
                <AmountInput
                  className="input"
                  value={form.allowance}
                  onChange={(value) => setForm((f) => ({ ...f, allowance: value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">За что доплата</label>
                <input
                  className="input"
                  value={form.allowanceDescription}
                  onChange={(e) => setForm((f) => ({ ...f, allowanceDescription: e.target.value }))}
                  placeholder="например: за аптеку на ул. Сункарова"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.managerBonusShareEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, managerBonusShareEnabled: e.target.checked }))}
                />
                10% от бонусов аптеки
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.ladderPremiumEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, ladderPremiumEnabled: e.target.checked }))}
                />
                Лестничная премия по выручке аптеки
                {form.employeeType === 'manager_trading' && ' (вместо личной премии за смену)'}
              </label>
            </div>

            <div>
              <label className="label">Аптеки (выберите одну или несколько)</label>
              {pharmacies.length === 0 ? (
                <p className="text-sm text-slate-400">Нет аптек в системе</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                  {pharmacies.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.pharmacyIds.includes(p.id)}
                        onChange={() => togglePharmacy(p.id)}
                        className="rounded"
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving && <span className="spinner" />}{editingId !== null ? 'Сохранить' : 'Создать'}
              </button>
              <button type="button" className="btn-secondary" onClick={resetForm}>Отмена</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : managers.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">
          Нет заведующих и менеджеров. Нажмите «+ Добавить» чтобы создать первого.
        </div>
      ) : (
        <div className="card overflow-hidden">
          {selectedIds.size > 0 && (
            <div className="px-4 py-2 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
              <span className="text-sm text-slate-900">Выбрано: {selectedIds.size}</span>
              <button className="btn-danger text-xs" onClick={deleteSelected}>
                Удалить выбранные
              </button>
            </div>
          )}
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="th w-8">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={managers.length > 0 && selectedIds.size === managers.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="th">Имя</th>
                <th className="th">Логин</th>
                <th className="th">Тип / оклад</th>
                <th className="th">Аптеки</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {managers.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="td">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                    />
                  </td>
                  <td className="td font-medium">{m.displayName}</td>
                  <td className="td text-slate-500 font-mono text-sm">
                    {m.accountType === 'employee' ? <span className="text-slate-300">нет доступа</span> : m.username}
                  </td>
                  <td className="td text-sm text-slate-600">
                    {MANAGER_TYPE_OPTIONS.find((t) => t.value === m.employeeType)?.label ?? m.employeeType}
                    <div className="text-xs text-slate-400">
                      {m.baseSalary.toLocaleString('ru-RU')} ₸
                      {m.managerBonusShareEnabled && (
                        <span className="text-green-600">{' '}· 10% от бонусов</span>
                      )}
                      {m.ladderPremiumEnabled && (
                        <span className="text-green-600">{' '}· премия по выручке аптеки</span>
                      )}
                      {m.allowance > 0 && (
                        <span title={m.allowanceDescription || undefined}>
                          {' '}· доплата {m.allowance.toLocaleString('ru-RU')} ₸
                          {m.allowanceDescription && ` (${m.allowanceDescription})`}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    {m.pharmacies.length === 0 ? (
                      <span className="text-amber-600 text-xs">Не привязан</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {m.pharmacies.map((p) => (
                          <span key={p.id} className="text-xs bg-slate-100 text-slate-800 border border-slate-300 px-1.5 py-0.5 rounded">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button className="btn-secondary text-xs" onClick={() => startEdit(m)}>
                        Изменить
                      </button>
                      <button className="btn-danger text-xs" onClick={() => deleteManager(m.id)}>
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SalaryImpactDialog
        open={pendingFields.length > 0}
        title="Изменение пересчитает зарплату задним числом"
        description={
          `Зарплата ${form.displayName || 'сотрудника'} нигде не хранится — она считается заново из ` +
          'текущих настроек. Поэтому изменение затронет не только будущие месяцы, но и все уже отработанные.'
        }
        changedFields={pendingFields}
        months={impact.data?.months ?? null}
        loading={impact.loading}
        onConfirm={doSubmit}
        onCancel={() => { setPendingFields([]); impact.reset(); }}
      />
    </div>
  );
}
