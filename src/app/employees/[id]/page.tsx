'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { SHIFT_TYPE_LABELS } from '@/lib/shift-types';

interface Employee {
  id: number;
  name: string;
  baseSalary: number;
  isActive: boolean;
  pharmacies: Pharmacy[];
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

interface SalaryResult {
  employeeId: number;
  employeeName: string;
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
  totalSalary: number;
  revenueTotal: number;
  recordsCount: number;
  shifts: ShiftEntry[];
  advances: AdvanceEntry[];
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
  const [form, setForm] = useState({ name: '', baseSalary: '', isActive: true });
  const [assignedPharmacyIds, setAssignedPharmacyIds] = useState<number[]>([]);
  const [editingPharmacies, setEditingPharmacies] = useState(false);
  const [pharmacySaving, setPharmacySaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [pharmacyId, setPharmacyId] = useState('');
  const [salary, setSalary] = useState<SalaryResult | null>(null);
  const [salaryLoading, setSalaryLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/employees/${id}`)
      .then((r) => r.json())
      .then((e: Employee) => {
        setEmployee(e);
        setForm({ name: e.name, baseSalary: String(e.baseSalary), isActive: e.isActive });
        setAssignedPharmacyIds(e.pharmacies.map((p) => p.id));
      });
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then(setPharmacies);
  }, [id]);

  const loadSalary = useCallback(async () => {
    setSalaryLoading(true);
    const q = new URLSearchParams({ month: String(month), year: String(year) });
    if (pharmacyId) q.set('pharmacyId', pharmacyId);
    const r = await fetch(`/api/employees/${id}/salary?${q}`);
    const data = await r.json();
    setSalary(data);
    setSalaryLoading(false);
  }, [id, month, year, pharmacyId]);

  useEffect(() => { loadSalary(); }, [loadSalary]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    const res = await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        baseSalary: form.baseSalary || 0,
        isActive: form.isActive,
      }),
    });
    if (res.ok) {
      const updated: Employee = await res.json();
      setEmployee(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } else {
      const data = await res.json();
      setSaveError(data.error || 'Ошибка при сохранении');
    }
    setSaving(false);
  }

  if (!employee) {
    return <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>;
  }

  const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/employees')}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← Сотрудники
        </button>
      </div>

      <div>
        <h1 className="text-xl font-bold text-gray-900">{employee.name}</h1>
        <p className="text-sm text-gray-500">Профиль сотрудника и расчёт зарплаты</p>
      </div>

      {/* Форма редактирования */}
      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Данные сотрудника</h2>

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
            <label className="label">Оклад (₸)</label>
            <input
              type="number"
              value={form.baseSalary}
              onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))}
              min="0"
              step="1"
              className="input"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isActive"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="rounded border-gray-300"
          />
          <label htmlFor="isActive" className="text-sm text-gray-700">Активен</label>
        </div>

        {pharmacies.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Аптеки</label>
              {!editingPharmacies && (
                <button
                  type="button"
                  onClick={() => setEditingPharmacies(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  изменить
                </button>
              )}
            </div>
            {editingPharmacies ? (
              <div className="mt-1 p-3 bg-gray-50 border border-gray-200 rounded-md">
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
                    {pharmacySaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setAssignedPharmacyIds(employee?.pharmacies.map((p) => p.id) ?? []);
                      setEditingPharmacies(false);
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {employee?.pharmacies.length === 0 ? (
                  <span className="text-sm text-amber-600">Аптека не привязана</span>
                ) : (
                  employee?.pharmacies.map((p) => (
                    <span key={p.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
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
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>

      {/* Расчёт зарплаты */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Расчёт зарплаты за месяц</h2>

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
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {salaryLoading ? (
          <div className="text-sm text-gray-400 py-4 text-center">Расчёт...</div>
        ) : salary && (salary.recordsCount > 0 || salary.advances.length > 0) ? (
          <>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                <span className="text-gray-500">Оклад</span>
                <span className="font-medium text-right">{fmt(salary.baseSalary)} ₸</span>

                <span className="text-gray-500">Дневных смен</span>
                <span className="font-medium text-right">
                  {salary.dayShiftsCount} × {fmt(salary.baseSalary / 15)} = {fmt(salary.salaryFromDayShifts)} ₸
                </span>

                <span className="text-gray-500">Суточных смен</span>
                <span className="font-medium text-right">
                  {salary.fullDayShiftsCount} × {fmt(salary.baseSalary / 10)} = {fmt(salary.salaryFromFullDayShifts)} ₸
                </span>

                <span className="text-gray-500">Пятидневных смен</span>
                <span className="font-medium text-right">
                  {salary.fiveDayShiftsCount > 0 && salary.workingCalendarDays ? (
                    <>{salary.fiveDayShiftsCount} × {fmt(salary.baseSalary / salary.workingCalendarDays)} = {fmt(salary.salaryFromFiveDayShifts)} ₸</>
                  ) : salary.fiveDayShiftsCount > 0 ? (
                    <span className="text-amber-600">{salary.fiveDayShiftsCount} смен — календарь не заполнен</span>
                  ) : (
                    <span className="text-gray-300">0</span>
                  )}
                </span>

                <span className="text-gray-500">Бонусы</span>
                <span className="font-medium text-right">{fmt(salary.totalBonuses)} ₸</span>

                <span className="text-gray-500">Премия по выручке</span>
                <span className={`font-medium text-right ${salary.totalRevenuePremium < 0 ? 'text-red-600' : ''}`}>
                  {fmt(salary.totalRevenuePremium)} ₸
                </span>

                {salary.totalAdvances > 0 && (
                  <>
                    <span className="text-gray-500">Авансы</span>
                    <span className="font-medium text-right text-red-600">−{fmt(salary.totalAdvances)} ₸</span>
                  </>
                )}

                <div className="col-span-2 border-t border-gray-200 my-1" />

                <span className="font-semibold text-gray-800">Итого зарплата</span>
                <span className={`font-bold text-right text-base ${salary.totalSalary < 0 ? 'text-red-700' : 'text-blue-700'}`}>{fmt(salary.totalSalary)} ₸</span>

                <span className="text-gray-500 text-xs">Записей выручки</span>
                <span className="text-right text-xs text-gray-500">{salary.recordsCount}</span>

                <span className="text-gray-500 text-xs">Выручка аптеки</span>
                <span className="text-right text-xs text-gray-500">{fmt(salary.revenueTotal)} ₸</span>
              </div>
            </div>

            {/* Детализация смен */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Смены за период</h3>
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                <div className="grid text-xs text-gray-400 font-medium px-3 py-1.5 bg-gray-50"
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
                    className="grid text-sm px-3 py-2 hover:bg-gray-50"
                    style={{ gridTemplateColumns: '6rem 1fr 6rem 5rem 5rem' }}
                  >
                    <span className="text-gray-600">
                      {new Date(s.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="text-gray-800 truncate pr-2">{s.pharmacyName}</span>
                    <span>
                      {s.shiftType ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          s.shiftType === 'full_day'
                            ? 'bg-purple-50 text-purple-700'
                            : s.shiftType === 'five_day'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}>
                          {SHIFT_TYPE_LABELS[s.shiftType] ?? s.shiftType}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </span>
                    <span className="text-right text-gray-600">
                      {fmt(s.cashRevenue + s.terminalRevenue + s.kaspiRevenue)}
                    </span>
                    <span className={`text-right font-medium ${s.bonusRevenue > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                      {s.bonusRevenue > 0 ? fmt(s.bonusRevenue) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Авансы */}
            {salary.advances.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Авансы за период</h3>
                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                  <div className="grid text-xs text-gray-400 font-medium px-3 py-1.5 bg-gray-50"
                    style={{ gridTemplateColumns: '6rem 1fr 6rem' }}>
                    <span>Дата</span>
                    <span>Аптека / комментарий</span>
                    <span className="text-right">Сумма</span>
                  </div>
                  {salary.advances.map((a) => (
                    <div
                      key={a.id}
                      className="grid text-sm px-3 py-2 hover:bg-gray-50"
                      style={{ gridTemplateColumns: '6rem 1fr 6rem' }}
                    >
                      <span className="text-gray-600">
                        {new Date(a.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <span className="text-gray-800 truncate pr-2">
                        {a.pharmacyName}
                        {a.comment && <span className="text-gray-400"> — {a.comment}</span>}
                      </span>
                      <span className="text-right font-medium text-red-600">−{fmt(a.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 py-4 text-center">
            Нет записей со связанным сотрудником за {MONTHS[month - 1].toLowerCase()} {year}.
          </div>
        )}
      </div>
    </div>
  );
}
