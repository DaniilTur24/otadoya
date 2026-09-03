'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { SHIFT_TYPE_LABELS } from '@/lib/shift-types';
import { EMPLOYEE_TYPE_LABELS, MANAGER_TYPES, USER_LINKED_TYPES, ATTENDANCE_BASED_TYPES } from '@/lib/employee-types';
import { AmountInput } from '@/components/AmountInput';
import { SalaryImpactDialog } from '@/components/SalaryImpactDialog';
import { useSalaryImpact } from '@/hooks/useSalaryImpact';

const EDITABLE_TYPES = [
  { value: 'seller', label: 'На кассе' },
  { value: 'seller_five_day_fixed', label: 'Суточник / пятидневка (фикс)' },
  { value: 'cleaner', label: 'Уборщица' },
  { value: 'office', label: 'Офис' },
] as const;

interface Employee {
  id: number;
  name: string;
  baseSalary: number;
  employeeType: string;
  shiftRate: number | null;
  allowance: number;
  allowanceDescription: string;
  isActive: boolean;
  pharmacies: Pharmacy[];
  fiveDayViaAttendance: boolean;
}

interface Pharmacy {
  id: number;
  name: string;
}

interface ShiftEntry {
  id: number;
  date: string;
  pharmacyName: string;
  shiftType: string | null;
  bonusRevenue: number;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
}

interface AdvanceEntry {
  id: number;
  date: string;
  pharmacyName: string;
  amount: number;
  comment: string | null;
}

interface SurchargeEntry {
  id: number;
  date: string;
  pharmacyName: string;
  amount: number;
  comment: string | null;
}

interface AttendanceEntry {
  id: number;
  date: string;
  pharmacyId: number | null;
  pharmacyName: string | null;
  overtimeHours: number;
}

interface SalaryResult {
  employeeId: number;
  employeeName: string;
  employeeType: string;
  month: number;
  year: number;
  baseSalary: number;
  dayShiftsCount: number;
  fullDayShiftsCount: number;
  fiveDayShiftsCount: number;
  salaryFromDayShifts: number;
  salaryFromFullDayShifts: number;
  salaryFromFiveDayShifts: number;
  workingCalendarDays: number | null;
  revenuePremiumDayShifts: number;
  revenuePremiumFullDayShifts: number;
  totalRevenuePremium: number;
  totalBonuses: number;
  totalAdvances: number;
  totalSurcharges: number;
  attendanceShiftsCount: number;
  shiftRate: number | null;
  salaryFromShiftRate: number;
  managerBonusShare: number;
  managedBonusTotal: number;
  allowance: number;
  allowanceDescription: string;
  managerLadderPremium: number;
  managedRevenueTotal: number;
  ladderPremiumEnabled: boolean;
  managerBonusShareEnabled: boolean;
  totalSalary: number;
  revenueTotal: number;
  recordsCount: number;
  shifts: ShiftEntry[];
  advances: AdvanceEntry[];
  surcharges: SurchargeEntry[];
  attendance: AttendanceEntry[];
  overtimeHours: number;
  /** Месяц закрыт */
  isClosed: boolean;
  /** Суммы взяты из снимка, сделанного при закрытии месяца, а не пересчитаны заново */
  isFrozen: boolean;
}

const MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const now = new Date();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [form, setForm] = useState({
    name: '', employeeType: 'seller', baseSalary: '', shiftRate: '',
    allowance: '', allowanceDescription: '', isActive: true, fiveDayViaAttendance: false,
  });
  const [assignedPharmacyIds, setAssignedPharmacyIds] = useState<number[]>([]);
  const [editingPharmacies, setEditingPharmacies] = useState(false);
  const [pharmacySaving, setPharmacySaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Непустой список = открыт диалог с предупреждением о пересчёте задним числом
  const [pendingFields, setPendingFields] = useState<string[]>([]);
  const impact = useSalaryImpact();

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [pharmacyId, setPharmacyId] = useState('');
  const [salary, setSalary] = useState<SalaryResult | null>(null);
  const [salaryLoading, setSalaryLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/employees/${id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((e: Employee) => {
        setEmployee(e);
        setForm({
          name: e.name,
          employeeType: e.employeeType,
          baseSalary: String(e.baseSalary),
          shiftRate: e.shiftRate != null ? String(e.shiftRate) : '',
          allowance: e.allowance ? String(e.allowance) : '',
          allowanceDescription: e.allowanceDescription ?? '',
          isActive: e.isActive,
          fiveDayViaAttendance: e.fiveDayViaAttendance,
        });
        setAssignedPharmacyIds((e.pharmacies ?? []).map((p) => p.id));
      })
      .catch((err) => { if (err.name !== 'AbortError') throw err; });
    fetch('/api/pharmacies', { signal: controller.signal })
      .then((r) => r.json())
      .then(setPharmacies)
      .catch((err) => { if (err.name !== 'AbortError') throw err; });
    return () => controller.abort();
  }, [id]);

  const loadSalary = useCallback(async (signal: AbortSignal) => {
    setSalaryLoading(true);
    const q = new URLSearchParams({ month: String(month), year: String(year) });
    if (pharmacyId) q.set('pharmacyId', pharmacyId);
    try {
      const r = await fetch(`/api/employees/${id}/salary?${q}`, { signal });
      const data = await r.json();
      setSalary(data);
      setSalaryLoading(false);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err;
    }
  }, [id, month, year, pharmacyId]);

  useEffect(() => {
    const controller = new AbortController();
    loadSalary(controller.signal);
    return () => controller.abort();
  }, [loadSalary]);

  // Тип, оклад и доплата заведующих/менеджеров редактируются на /users, чтобы не разойтись с аккаунтом
  const isUserLinked = USER_LINKED_TYPES.has(employee?.employeeType ?? '');

  function buildPayload() {
    return {
      name: form.name.trim(),
      ...(isUserLinked ? {} : {
        employeeType: form.employeeType,
        baseSalary: form.baseSalary || 0,
        allowance: form.allowance || 0,
        allowanceDescription: form.allowanceDescription.trim(),
      }),
      shiftRate: form.employeeType === 'cleaner' || form.employeeType === 'seller_five_day_fixed' ? form.shiftRate || 0 : null,
      fiveDayViaAttendance: form.employeeType === 'seller' ? form.fiveDayViaAttendance : false,
      isActive: form.isActive,
    };
  }

  /**
   * Какие из изменённых полей пересчитают зарплату за уже отработанные месяцы.
   * Имя и описание доплаты сюда не входят — они на расчёт не влияют, и предупреждать
   * о них значило бы приучить жать «Сохранить» не читая.
   */
  function changedSalaryFields(): string[] {
    if (!employee) return [];
    const money = (n: number) => n.toLocaleString('ru-RU');
    const p = buildPayload() as Record<string, unknown>;
    const changed: string[] = [];

    if (p.employeeType !== undefined && p.employeeType !== employee.employeeType) {
      const from = EMPLOYEE_TYPE_LABELS[employee.employeeType] ?? employee.employeeType;
      const to = EMPLOYEE_TYPE_LABELS[p.employeeType as string] ?? String(p.employeeType);
      changed.push(`Тип сотрудника: ${from} → ${to} (меняется сама формула расчёта)`);
    }
    if (p.baseSalary !== undefined && Number(p.baseSalary) !== Number(employee.baseSalary)) {
      changed.push(`Оклад: ${money(Number(employee.baseSalary))} → ${money(Number(p.baseSalary))} ₸`);
    }
    if (p.allowance !== undefined && Number(p.allowance) !== Number(employee.allowance ?? 0)) {
      changed.push(`Фиксированная доплата: ${money(Number(employee.allowance ?? 0))} → ${money(Number(p.allowance))} ₸`);
    }
    if (
      (form.employeeType === 'cleaner' || form.employeeType === 'seller_five_day_fixed') &&
      Number(p.shiftRate ?? 0) !== Number(employee.shiftRate ?? 0)
    ) {
      changed.push(`Ставка за смену: ${money(Number(employee.shiftRate ?? 0))} → ${money(Number(p.shiftRate ?? 0))} ₸`);
    }
    if (p.fiveDayViaAttendance !== employee.fiveDayViaAttendance) {
      changed.push(
        p.fiveDayViaAttendance
          ? 'Пятидневка по табелю: включается (смены будут читаться из табеля, а не из выручки)'
          : 'Пятидневка по табелю: выключается (отметки табеля перестанут оплачиваться)'
      );
    }
    if (!p.isActive && employee.isActive) {
      changed.push('Сотрудник деактивируется — его зарплата исчезнет из отчётов за все незакрытые месяцы');
    }
    return changed;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const changed = changedSalaryFields();
    if (changed.length > 0) {
      setPendingFields(changed);
      impact.load(`/api/employees/${id}/salary-impact`);
      return;
    }
    doSave();
  }

  async function doSave() {
    setPendingFields([]);
    impact.reset();
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    const res = await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    if (res.ok) {
      const updated: Employee = await res.json();
      setEmployee(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Перечитываем зарплату: изменённый оклад/тип меняет цифры выбранного месяца прямо сейчас
      loadSalary(new AbortController().signal);
    } else {
      const data = await res.json();
      setSaveError(data.error || 'Ошибка при сохранении');
    }
    setSaving(false);
  }

  if (!employee) {
    return (
      <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
        <span className="spinner" /> Загрузка...
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  // Продавец с включённым fiveDayViaAttendance отмечается в табеле вместо смены в записи
  // выручки — переключатель "всё или ничего" (см. canGetRevenueShift). Его переработка и явки
  // читаются из табеля, как у обычных табельных типов.
  const isFiveDaySeller = employee.employeeType === 'seller' && employee.fiveDayViaAttendance;
  // seller_five_day_fixed показывает и смены выручки, и табель одновременно — у него оба
  // источника разрешены (в разные дни), в отличие от isFiveDaySeller (только табель).
  const isSellerFiveDayFixedEmployee = employee.employeeType === 'seller_five_day_fixed';
  // manager_trading с fiveDayViaAttendance — тоже смешанный режим (как seller_five_day_fixed),
  // просто по другой формуле (baseSalary/workingCalendarDays, а не фикс. ставка).
  const isMixedFiveDayManager = employee.employeeType === 'manager_trading' && employee.fiveDayViaAttendance;

  return (
    <div className="max-w-screen-lg space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/employees')}
          className="text-sm text-slate-400 hover:text-slate-600"
        >
          ← Сотрудники
        </button>
      </div>

      <div>
        <h1 className="text-lg font-semibold text-slate-900">{employee.name}</h1>
        <p className="text-sm text-slate-500">Профиль сотрудника и расчёт зарплаты</p>
      </div>

      {/* Форма редактирования */}
      <form onSubmit={handleSave} className="card p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">Данные сотрудника</h2>

        {saveSuccess && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">
            Изменения сохранены.
          </div>
        )}
        {saveError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {saveError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Имя *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="input"
            />
          </div>
          <div>
            <label className="label">Тип сотрудника</label>
            {USER_LINKED_TYPES.has(employee.employeeType) ? (
              <>
                <input
                  type="text"
                  value={EMPLOYEE_TYPE_LABELS[employee.employeeType] ?? employee.employeeType}
                  disabled
                  className="input bg-slate-50 text-slate-400"
                />
                <p className="text-xs text-slate-400 mt-1">Редактируется на странице «Заведующие и менеджеры» (/users)</p>
              </>
            ) : (
              <select
                value={form.employeeType}
                onChange={(e) => setForm((f) => ({ ...f, employeeType: e.target.value }))}
                className="input"
              >
                {EDITABLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            )}
          </div>
          {form.employeeType === 'cleaner' && !USER_LINKED_TYPES.has(employee.employeeType) ? (
            <div>
              <label className="label">Ставка за смену (₸)</label>
              <AmountInput
                value={form.shiftRate}
                onChange={(value) => setForm((f) => ({ ...f, shiftRate: value }))}
                className="input"
              />
            </div>
          ) : form.employeeType === 'seller_five_day_fixed' && !USER_LINKED_TYPES.has(employee.employeeType) ? (
            <>
              <div>
                <label className="label">Оклад (₸) — для смен из выручки</label>
                <AmountInput
                  value={form.baseSalary}
                  onChange={(value) => setForm((f) => ({ ...f, baseSalary: value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Ставка за смену (₸) — для табеля</label>
                <AmountInput
                  value={form.shiftRate}
                  onChange={(value) => setForm((f) => ({ ...f, shiftRate: value }))}
                  className="input"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="label">Оклад (₸)</label>
              <AmountInput
                value={form.baseSalary}
                onChange={(value) => setForm((f) => ({ ...f, baseSalary: value }))}
                disabled={USER_LINKED_TYPES.has(employee.employeeType)}
                className={`input ${USER_LINKED_TYPES.has(employee.employeeType) ? 'bg-slate-50 text-slate-400' : ''}`}
              />
            </div>
          )}
        </div>

        {form.employeeType === 'seller' && !USER_LINKED_TYPES.has(employee.employeeType) && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.fiveDayViaAttendance}
              onChange={(e) => setForm((f) => ({ ...f, fiveDayViaAttendance: e.target.checked }))}
              className="rounded"
            />
            Пятидневка — отмечается в табеле посещаемости
            <span className="text-slate-400 font-normal">(вместо записи выручки на каждый рабочий день)</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Фиксированная доплата (₸/мес)</label>
            <AmountInput
              value={form.allowance}
              onChange={(value) => setForm((f) => ({ ...f, allowance: value }))}
              disabled={USER_LINKED_TYPES.has(employee.employeeType)}
              className={`input ${USER_LINKED_TYPES.has(employee.employeeType) ? 'bg-slate-50 text-slate-400' : ''}`}
            />
          </div>
          <div>
            <label className="label">За что доплата</label>
            <input
              type="text"
              value={form.allowanceDescription}
              onChange={(e) => setForm((f) => ({ ...f, allowanceDescription: e.target.value }))}
              placeholder="например: за стаж"
              disabled={USER_LINKED_TYPES.has(employee.employeeType)}
              className={`input ${USER_LINKED_TYPES.has(employee.employeeType) ? 'bg-slate-50 text-slate-400' : ''}`}
            />
          </div>
          {USER_LINKED_TYPES.has(employee.employeeType) && (
            <p className="text-xs text-slate-400 -mt-2 col-span-2">Редактируется на странице «Заведующие и менеджеры» (/users)</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="rounded border-slate-300"
          />
          <label htmlFor="isActive" className="text-sm text-slate-700">Активен</label>
        </div>

        {pharmacies.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Аптеки</label>
              {!editingPharmacies && (
                <button
                  type="button"
                  onClick={() => setEditingPharmacies(true)}
                  className="text-xs text-slate-700 hover:text-slate-900 underline"
                >
                  изменить
                </button>
              )}
            </div>
            {editingPharmacies ? (
              <div className="mt-1 p-3 bg-slate-50 border border-slate-300 rounded">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                  {pharmacies.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={assignedPharmacyIds.includes(p.id)}
                        onChange={() =>
                          setAssignedPharmacyIds((ids) =>
                            ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]
                          )
                        }
                        className="rounded"
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={pharmacySaving}
                    onClick={async () => {
                      setPharmacySaving(true);
                      await fetch(`/api/employees/${id}/pharmacies`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pharmacyIds: assignedPharmacyIds }),
                      });
                      setPharmacySaving(false);
                      setEditingPharmacies(false);
                      const updated: Employee = await fetch(`/api/employees/${id}`).then((r) => r.json());
                      setEmployee(updated);
                      setAssignedPharmacyIds(updated.pharmacies.map((p) => p.id));
                    }}
                  >
                    {pharmacySaving && <span className="spinner" />}{pharmacySaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setAssignedPharmacyIds(employee?.pharmacies?.map((p) => p.id) ?? []);
                      setEditingPharmacies(false);
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(employee?.pharmacies?.length ?? 0) === 0 ? (
                  <span className="text-sm text-amber-600">Аптека не привязана</span>
                ) : (
                  employee?.pharmacies?.map((p) => (
                    <span key={p.id} className="text-xs bg-slate-100 text-slate-800 border border-slate-300 px-1.5 py-0.5 rounded">
                      {p.name}
                    </span>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary text-sm" disabled={saving}>
            {saving && <span className="spinner" />}{saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>

      {/* Расчёт зарплаты */}
      <div className="card p-4 space-y-3">
        <h2 className="font-semibold text-slate-800">Расчёт зарплаты за месяц</h2>

        {salary?.isFrozen && (
          <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            🔒 Месяц закрыт — суммы зафиксированы на момент закрытия и больше не пересчитываются.
            Изменение оклада или производственного календаря их не затронет.
          </div>
        )}
        {salary?.isClosed && !salary.isFrozen && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Месяц закрыт, но этого сотрудника нет в снимке — суммы считаются заново по текущим
            настройкам и могут отличаться от того, что было при закрытии.
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Месяц</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="input"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Год</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min="2020"
              max="2100"
              className="input"
            />
          </div>
          <div>
            <label className="label">Аптека</label>
            <select
              value={pharmacyId}
              onChange={(e) => setPharmacyId(e.target.value)}
              className="input"
            >
              <option value="">Все аптеки</option>
              {(employee.pharmacies ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {salaryLoading ? (
          <div className="text-sm text-slate-400 py-4 text-center flex items-center justify-center gap-2">
            <span className="spinner" /> Расчёт...
          </div>
        ) : salary && (
            salary.recordsCount > 0 ||
            salary.advances.length > 0 ||
            salary.surcharges.length > 0 ||
            salary.overtimeHours > 0 ||
            USER_LINKED_TYPES.has(salary.employeeType)
          ) ? (
          <>
            {(() => {
              const isAttendanceBased = ATTENDANCE_BASED_TYPES.has(salary.employeeType);
              const isManager = MANAGER_TYPES.has(salary.employeeType);
              const isCleaner = salary.employeeType === 'cleaner';
              const isOffice = salary.employeeType === 'office';
              const isSeller = salary.employeeType === 'seller';
              const isSellerFiveDayFixed = salary.employeeType === 'seller_five_day_fixed';
              return (
                <div className="bg-slate-50 border border-slate-300 rounded p-3 space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                    {isCleaner ? (
                      <>
                        <span className="text-slate-500">Ставка за смену</span>
                        <span className="font-medium text-right">{fmt(salary.shiftRate ?? 0)} ₸</span>

                        <span className="text-slate-500">Отработано смен</span>
                        <span className="font-medium text-right">
                          {salary.attendanceShiftsCount} × {fmt(salary.shiftRate ?? 0)} = {fmt(salary.salaryFromShiftRate)} ₸
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-500">Оклад</span>
                        <span className="font-medium text-right">{fmt(salary.baseSalary)} ₸</span>

                        {!isAttendanceBased && (
                          <>
                            <span className="text-slate-500">Дневных смен</span>
                            <span className="font-medium text-right">
                              {/* Показываем среднюю ставку как итог ÷ количество (не baseSalary/15 напрямую) —
                                  итог теперь округлён до 5 тенге, и count × baseSalary/15 с ним не сходится. */}
                              {salary.dayShiftsCount} × {fmt(salary.dayShiftsCount > 0 ? salary.salaryFromDayShifts / salary.dayShiftsCount : salary.baseSalary / 15)} = {fmt(salary.salaryFromDayShifts)} ₸
                            </span>

                            <span className="text-slate-500">Суточных смен</span>
                            <span className="font-medium text-right">
                              {salary.fullDayShiftsCount} × {fmt(salary.fullDayShiftsCount > 0 ? salary.salaryFromFullDayShifts / salary.fullDayShiftsCount : salary.baseSalary / 10)} = {fmt(salary.salaryFromFullDayShifts)} ₸
                            </span>
                          </>
                        )}

                        <span className="text-slate-500">
                          {isAttendanceBased ? 'Смен по табелю' : isSellerFiveDayFixed ? 'Смен по табелю (фикс. ставка)' : 'Пятидневных смен'}
                        </span>
                        <span className="font-medium text-right">
                          {isSellerFiveDayFixed ? (
                            salary.fiveDayShiftsCount > 0 ? (
                              <>{salary.fiveDayShiftsCount} × {fmt(salary.salaryFromFiveDayShifts / salary.fiveDayShiftsCount)} = {fmt(salary.salaryFromFiveDayShifts)} ₸</>
                            ) : (
                              <span className="text-slate-300">0</span>
                            )
                          ) : salary.fiveDayShiftsCount > 0 && salary.workingCalendarDays ? (
                            <>{salary.fiveDayShiftsCount} × {fmt(salary.salaryFromFiveDayShifts / salary.fiveDayShiftsCount)} = {fmt(salary.salaryFromFiveDayShifts)} ₸</>
                          ) : salary.fiveDayShiftsCount > 0 ? (
                            <span className="text-amber-600">{salary.fiveDayShiftsCount} смен — календарь не заполнен</span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </span>
                      </>
                    )}

                    {!isAttendanceBased && !isCleaner && (
                      <>
                        <span className="text-slate-500">Бонусы</span>
                        <span className="font-medium text-right">{fmt(salary.totalBonuses)} ₸</span>
                      </>
                    )}

                    {(isSeller || isSellerFiveDayFixed) && (
                      <>
                        <span className="text-slate-500">Премия по выручке</span>
                        <span className={`font-medium text-right ${salary.totalRevenuePremium < 0 ? 'text-red-600' : ''}`}>
                          {fmt(salary.totalRevenuePremium)} ₸
                        </span>
                      </>
                    )}

                    {isManager && (
                      <>
                        <span className="text-slate-500">
                          {salary.managerBonusShareEnabled
                            ? `10% от бонусов аптеки (${fmt(salary.managedBonusTotal)} ₸)`
                            : '10% от бонусов аптеки'}
                        </span>
                        {salary.managerBonusShareEnabled ? (
                          <span className="font-medium text-right">{fmt(salary.managerBonusShare)} ₸</span>
                        ) : (
                          <span className="text-right text-slate-400">Выключено</span>
                        )}

                        <span className="text-slate-500">
                          {salary.ladderPremiumEnabled
                            ? `Премия по выручке аптеки (${fmt(salary.managedRevenueTotal)} ₸)`
                            : 'Премия по выручке аптеки'}
                        </span>
                        {salary.ladderPremiumEnabled ? (
                          <span className={`font-medium text-right ${salary.managerLadderPremium < 0 ? 'text-red-600' : ''}`}>
                            {fmt(salary.managerLadderPremium)} ₸
                          </span>
                        ) : (
                          <span className="text-right text-slate-400">Выключено</span>
                        )}
                      </>
                    )}

                    {isOffice && (
                      <>
                        <span className="text-slate-500">
                          Премия от выручки всех аптек ({fmt(salary.managedRevenueTotal)} ₸)
                        </span>
                        <span className="font-medium text-right">{fmt(salary.managerLadderPremium)} ₸</span>
                      </>
                    )}

                    {salary.allowance > 0 && (
                      <>
                        <span className="text-slate-500">
                          Фиксированная доплата{salary.allowanceDescription ? ` (${salary.allowanceDescription})` : ''}
                        </span>
                        <span className="font-medium text-right">{fmt(salary.allowance)} ₸</span>
                      </>
                    )}

                    {salary.totalSurcharges > 0 && (
                      <>
                        <span className="text-slate-500">Доплаты</span>
                        <span className="font-medium text-right">+{fmt(salary.totalSurcharges)} ₸</span>
                      </>
                    )}

                    {salary.totalAdvances > 0 && (
                      <>
                        <span className="text-slate-500">Авансы</span>
                        <span className="font-medium text-right text-red-600">−{fmt(salary.totalAdvances)} ₸</span>
                      </>
                    )}

                    <div className="col-span-2 border-t border-slate-200 my-1" />

                    <span className="font-semibold text-slate-800">Итого зарплата</span>
                    <span className={`font-bold text-right text-base ${salary.totalSalary < 0 ? 'text-red-700' : 'text-slate-800'}`}>{fmt(salary.totalSalary)} ₸</span>

                    {!isAttendanceBased && (
                      <>
                        <span className="text-slate-500 text-xs">Записей выручки</span>
                        <span className="text-right text-xs text-slate-500">{salary.recordsCount}</span>

                        <span className="text-slate-500 text-xs">Выручка аптеки</span>
                        <span className="text-right text-xs text-slate-500">{fmt(salary.revenueTotal)} ₸</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Детализация смен (продавцы и торгующие заведующие; не для пятидневников по табелю) */}
            {!ATTENDANCE_BASED_TYPES.has(salary.employeeType) && !isFiveDaySeller && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Смены за период</h3>
              <div className="divide-y divide-slate-100 border border-slate-100 rounded overflow-hidden">
                <div className="grid text-xs text-slate-400 font-medium px-3 py-1.5 bg-slate-50"
                  style={{ gridTemplateColumns: '6rem 1fr 6rem 5rem 5rem' }}>
                  <span>Дата</span>
                  <span>Аптека</span>
                  <span>Смена</span>
                  <span className="text-right">Выручка</span>
                  <span className="text-right">Бонус</span>
                </div>
                {salary.shifts.map((s) => (
                  <div
                    key={s.id}
                    className="grid text-sm px-3 py-2 hover:bg-slate-50"
                    style={{ gridTemplateColumns: '6rem 1fr 6rem 5rem 5rem' }}
                  >
                    <span className="text-slate-600">
                      {new Date(s.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="text-slate-800 truncate pr-2">{s.pharmacyName}</span>
                    <span>
                      {s.shiftType ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          s.shiftType === 'full_day'
                            ? 'bg-slate-200 text-slate-800'
                            : s.shiftType === 'five_day'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-slate-100 text-slate-800'
                        }`}>
                          {SHIFT_TYPE_LABELS[s.shiftType] ?? s.shiftType}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </span>
                    <span className="text-right text-slate-600">
                      {fmt(s.cashRevenue + s.terminalRevenue + s.kaspiRevenue)}
                    </span>
                    <span className={`text-right font-medium ${s.bonusRevenue > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                      {s.bonusRevenue > 0 ? fmt(s.bonusRevenue) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* Табель посещаемости (manager_fixed / cleaner / office / pharmacy_manager, а также
                продавец с включённой пятидневкой по табелю) */}
            {(ATTENDANCE_BASED_TYPES.has(salary.employeeType) || isFiveDaySeller || isSellerFiveDayFixedEmployee || isMixedFiveDayManager) && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">Табель посещаемости за период</h3>
                  {salary.overtimeHours > 0 && (
                    <span className="text-sm text-slate-600">
                      Переработка: <span className="font-medium text-slate-800">{fmt(salary.overtimeHours)} ч</span>
                    </span>
                  )}
                </div>
                {salary.attendance.length === 0 ? (
                  <div className="text-sm text-slate-400 py-2">Нет отметок за этот месяц.</div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded overflow-hidden">
                    <div className="grid text-xs text-slate-400 font-medium px-3 py-1.5 bg-slate-50"
                      style={{ gridTemplateColumns: '6rem 1fr 6rem' }}>
                      <span>Дата</span>
                      <span>Аптека</span>
                      <span className="text-right">Переработка</span>
                    </div>
                    {salary.attendance.map((a) => (
                      <div
                        key={a.id}
                        className="grid text-sm px-3 py-2 hover:bg-slate-50"
                        style={{ gridTemplateColumns: '6rem 1fr 6rem' }}
                      >
                        <span className="text-slate-600">
                          {new Date(a.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                        </span>
                        <span className="text-slate-800">{a.pharmacyName ?? '—'}</span>
                        <span className={`text-right font-medium ${a.overtimeHours > 0 ? 'text-amber-700' : 'text-slate-300'}`}>
                          {a.overtimeHours > 0 ? `${fmt(a.overtimeHours)} ч` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Авансы */}
            {salary.advances.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Авансы за период</h3>
                <div className="divide-y divide-slate-100 border border-slate-100 rounded overflow-hidden">
                  <div className="grid text-xs text-slate-400 font-medium px-3 py-1.5 bg-slate-50"
                    style={{ gridTemplateColumns: '6rem 1fr 6rem' }}>
                    <span>Дата</span>
                    <span>Аптека / комментарий</span>
                    <span className="text-right">Сумма</span>
                  </div>
                  {salary.advances.map((a) => (
                    <div
                      key={a.id}
                      className="grid text-sm px-3 py-2 hover:bg-slate-50"
                      style={{ gridTemplateColumns: '6rem 1fr 6rem' }}
                    >
                      <span className="text-slate-600">
                        {new Date(a.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <span className="text-slate-800 truncate pr-2">
                        {a.pharmacyName}
                        {a.comment && <span className="text-slate-400"> — {a.comment}</span>}
                      </span>
                      <span className="text-right font-medium text-red-600">−{fmt(a.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Доплаты */}
            {salary.surcharges.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Доплаты за период</h3>
                <div className="divide-y divide-slate-100 border border-slate-100 rounded overflow-hidden">
                  <div className="grid text-xs text-slate-400 font-medium px-3 py-1.5 bg-slate-50"
                    style={{ gridTemplateColumns: '6rem 1fr 6rem' }}>
                    <span>Дата</span>
                    <span>Аптека / комментарий</span>
                    <span className="text-right">Сумма</span>
                  </div>
                  {salary.surcharges.map((s) => (
                    <div
                      key={s.id}
                      className="grid text-sm px-3 py-2 hover:bg-slate-50"
                      style={{ gridTemplateColumns: '6rem 1fr 6rem' }}
                    >
                      <span className="text-slate-600">
                        {new Date(s.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <span className="text-slate-800 truncate pr-2">
                        {s.pharmacyName}
                        {s.comment && <span className="text-slate-400"> — {s.comment}</span>}
                      </span>
                      <span className="text-right font-medium">+{fmt(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-slate-400 py-4 text-center">
            Нет записей со связанным сотрудником за {MONTHS[month - 1].toLowerCase()} {year}.
          </div>
        )}
      </div>

      <SalaryImpactDialog
        open={pendingFields.length > 0}
        title="Изменение пересчитает зарплату задним числом"
        description={
          `Зарплата ${employee.name} нигде не хранится — она считается заново из текущих настроек. ` +
          'Поэтому изменение затронет не только будущие месяцы, но и все уже отработанные.'
        }
        changedFields={pendingFields}
        months={impact.data?.months ?? null}
        loading={impact.loading}
        onConfirm={doSave}
        onCancel={() => { setPendingFields([]); impact.reset(); }}
      />
    </div>
  );
}
