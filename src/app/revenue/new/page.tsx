'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MONTHLY_REPORT_ROWS, MONTHLY_EXPENSE_KEYS, monthlyFieldType } from '@/lib/monthly-report-fields';
import { SHIFT_OPTIONS } from '@/lib/shift-types';
import { ATTENDANCE_BASED_TYPES } from '@/lib/employee-types';

interface Pharmacy {
  id: number;
  name: string;
}

interface Employee {
  id: number;
  name: string;
  employeeType: string;
}

interface ExpenseItem {
  id: number;
  amount: string;
  category: string;
  comment: string;
}

const EXPENSE_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) =>
    !row.section &&
    row.key !== 'employeeAdvance' &&
    (MONTHLY_EXPENSE_KEYS as readonly string[]).includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

const INCOME_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) =>
    !row.section &&
    row.rowType === 'income' &&
    row.source !== 'calc' &&
    !['retailRevenue', 'kaspiRevenue', 'wholesaleRevenue'].includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

let nextId = 1;

function emptyItem(): ExpenseItem {
  return { id: nextId++, amount: '', category: '', comment: '' };
}

export default function NewRevenuePage() {
  const router = useRouter();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [monthClosedWarning, setMonthClosedWarning] = useState(false);
  const [selectedMonthClosed, setSelectedMonthClosed] = useState(false);
  const [error, setError] = useState('');

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    pharmacyId: '',
    date: today,
    cashRevenue: '',
    terminalRevenue: '',
    kaspiRevenue: '',
    generalComment: '',
    employeeId: '',
    employeeName: '',
    shiftType: '',
    avans: '',
    avansEmployeeId: '',
  });

  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setRole(d.role ?? null));
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/pharmacies').then((r) => r.json()),
    ]).then(([pharmas]) => {
      setPharmacies(pharmas);
      // Для менеджера с одной аптекой — автовыбор
      if (pharmas.length === 1) {
        setForm((f) => ({ ...f, pharmacyId: String(pharmas[0].id) }));
      }
    });
  }, []);

  // Перезагружаем сотрудников при смене аптеки (для менеджера — фильтрация по аптеке)
  useEffect(() => {
    if (!form.pharmacyId) {
      setEmployees([]);
      return;
    }
    const url = `/api/employees?isActive=true&pharmacyId=${form.pharmacyId}`;
    fetch(url)
      .then((r) => r.json())
      .then((emps) => {
        setEmployees(emps);
        // Сбрасываем выбор сотрудника если его нет в новом списке
        setForm((f) => {
          const stillValid = emps.some((e: Employee) => e.id === Number(f.employeeId));
          return stillValid ? f : { ...f, employeeId: '', employeeName: '' };
        });
      });
  }, [form.pharmacyId, role]);

  useEffect(() => {
    if (!form.date) return;
    const d = new Date(form.date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    fetch(`/api/months/close?year=${year}&month=${month}`)
      .then((r) => r.json())
      .then((data) => setSelectedMonthClosed(data.isClosed));
  }, [form.date]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((f) => {
      const updated = { ...f, [name]: value };
      // Автозаполнение имени при выборе сотрудника из списка
      if (name === 'employeeId') {
        const emp = employees.find((em) => em.id === Number(value));
        updated.employeeName = emp ? emp.name : '';
      }
      return updated;
    });
  }

  function addExpenseItem() {
    setExpenseItems((items) => [...items, emptyItem()]);
  }

  function removeExpenseItem(id: number) {
    setExpenseItems((items) => items.filter((i) => i.id !== id));
  }

  function updateExpenseItem(id: number, field: 'amount' | 'category' | 'comment', value: string) {
    setExpenseItems((items) =>
      items.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );
  }

  // Сотрудники с табельной оплатой (manager_fixed/cleaner/office/pharmacy_manager) не привязаны
  // к смене в записи выручки — их зарплата считается только через табель посещаемости.
  const shiftEligibleEmployees = employees.filter((e) => !ATTENDANCE_BASED_TYPES.has(e.employeeType));

  const totalExpenses = expenseItems.reduce(
    (sum, i) => sum + (parseFloat(i.amount) || 0),
    0
  );

  const totalRevenue =
    (parseFloat(form.cashRevenue) || 0) +
    (parseFloat(form.terminalRevenue) || 0) +
    (parseFloat(form.kaspiRevenue) || 0);

  const cashRevenueNum = parseFloat(form.cashRevenue) || 0;
  const avansNum = parseFloat(form.avans) || 0;
  const summaryBonuses = expenseItems
    .filter((i) => i.category === 'pharmaBonus')
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const summaryAdvances =
    expenseItems
      .filter((i) => i.category === 'employeeAdvance')
      .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0) + avansNum;
  const summaryIncomes = expenseItems
    .filter((i) => i.category !== 'pharmaBonus' && i.category !== 'employeeAdvance' && monthlyFieldType(i.category) === 'income')
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const summaryExpenses = expenseItems
    .filter((i) => i.category !== 'pharmaBonus' && i.category !== 'employeeAdvance' && monthlyFieldType(i.category) !== 'income')
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const grandTotal = totalRevenue + summaryIncomes - summaryExpenses - summaryBonuses - summaryAdvances;
  const cashNet = cashRevenueNum - summaryBonuses - summaryAdvances - summaryExpenses;

  const selectedDate = new Date(form.date);
  const now = new Date();
  const isOtherMonth =
    selectedDate.getFullYear() !== now.getFullYear() ||
    selectedDate.getMonth() !== now.getMonth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const validItems = expenseItems.filter((i) => parseFloat(i.amount) > 0);
    const missingCategory = validItems.find((i) => !i.category);
    if (missingCategory) {
      setError('Выберите категорию расхода для каждой строки');
      setSubmitting(false);
      return;
    }

    const employeeName = form.employeeName.trim();
    if (!employeeName) {
      setError('Выберите сотрудника из списка');
      setSubmitting(false);
      return;
    }

    const avansAmount = parseFloat(form.avans) || 0;
    if (avansAmount > 0 && !form.avansEmployeeId) {
      setError('Выберите сотрудника, которому выдан аванс');
      setSubmitting(false);
      return;
    }

    type SubmitExpenseItem = { amount: string; category: string | null; comment: string | null; employeeId?: number };
    const allExpenseItems: SubmitExpenseItem[] = validItems.map((i) => ({
      amount: i.amount,
      category: i.category,
      comment: i.comment || null,
    }));
    if (avansAmount > 0 && form.avansEmployeeId) {
      const avansEmployee = employees.find((e) => e.id === Number(form.avansEmployeeId));
      allExpenseItems.push({
        amount: form.avans,
        category: 'employeeAdvance',
        comment: avansEmployee ? `Аванс: ${avansEmployee.name}` : null,
        employeeId: Number(form.avansEmployeeId),
      });
    }

    const res = await fetch('/api/revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pharmacyId: Number(form.pharmacyId),
        date: form.date,
        cashRevenue: form.cashRevenue || '0',
        terminalRevenue: form.terminalRevenue || '0',
        kaspiRevenue: form.kaspiRevenue || '0',
        employeeId: form.employeeId ? Number(form.employeeId) : null,
        employeeName,
        shiftType: form.shiftType || null,
        expenseItems: allExpenseItems,
        generalComment: form.generalComment || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setSuccess(true);
      setMonthClosedWarning(data.monthClosed === true);
      setForm({
        pharmacyId: form.pharmacyId,
        date: today,
        cashRevenue: '',
        terminalRevenue: '',
        kaspiRevenue: '',
        generalComment: '',
        employeeId: form.employeeId,
        employeeName: form.employeeName,
        shiftType: form.shiftType,
        avans: '',
        avansEmployeeId: '',
      });
      setExpenseItems([]);
      setTimeout(() => setSuccess(false), 4000);
    } else {
      const data = await res.json();
      setError(data.error || 'Ошибка при сохранении');
    }
    setSubmitting(false);
  }

  return (
    <div className="max-w-screen-xl">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Добавить дневную выручку</h1>
      <p className="text-slate-500 text-sm mb-4">
        Бухгалтер вводит данные с бумажного листочка сотрудника. Запись сразу сохраняется в отчёт.
      </p>

      {role === 'manager' && (
        <div className="mb-4 p-3 bg-slate-100 border border-slate-300 rounded-md text-slate-900 text-sm">
          Ваша запись будет отправлена на проверку бухгалтеру и появится в отчёте после подтверждения.
        </div>
      )}

      {selectedMonthClosed && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-md text-amber-800 text-sm">
          <strong>Этот месяц уже закрыт.</strong> Запись будет сохранена, но не будет учитываться в закрытии месяца и будет помечена как исключённая.
        </div>
      )}
      {success && !monthClosedWarning && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-800 text-sm">
          Запись сохранена.
        </div>
      )}
      {success && monthClosedWarning && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-md text-amber-800 text-sm">
          <strong>Запись сохранена, но этот месяц уже закрыт.</strong> Данная запись не будет учитываться в закрытии месяца и помечена как исключённая.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-4 space-y-3">
        {/* Аптека и дата */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="label">Аптека *</label>
            <select
              name="pharmacyId"
              value={form.pharmacyId}
              onChange={handleChange}
              required
              className="input"
            >
              <option value="">— выберите аптеку —</option>
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Дата *</label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              required
              className="input"
            />
            {isOtherMonth && (
              <p className="mt-1 text-xs text-amber-600 font-medium">
                Дата не совпадает с текущим месяцем — запись попадёт в другой отчёт
              </p>
            )}
          </div>

        </div>

        {/* Сотрудник и смена */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Сотрудник *</label>
            {shiftEligibleEmployees.length > 0 ? (
              <>
                <select
                  name="employeeId"
                  value={form.employeeId}
                  onChange={handleChange}
                  required
                  className="input"
                >
                  <option value="">— выберите из списка —</option>
                  {shiftEligibleEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  Нет нужного?{' '}
                  <a href="/employees" target="_blank" className="text-slate-700 hover:underline">
                    Добавить сотрудника
                  </a>
                </p>
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Нет сотрудников со сменной оплатой в этой аптеке.{' '}
                <a href="/employees" target="_blank" className="font-medium underline">
                  Добавьте сотрудника
                </a>
                {' '}— затем вернитесь сюда.
              </div>
            )}
          </div>

          <div>
            <label className="label">Тип смены</label>
            <select
              name="shiftType"
              value={form.shiftType}
              onChange={handleChange}
              className="input"
            >
              <option value="">— не указан —</option>
              {SHIFT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {!form.shiftType && (
              <p className="mt-1 text-xs text-amber-600">
                Без типа смены зарплата не рассчитается
              </p>
            )}
          </div>
        </div>

        {/* Аванс — может быть выдан другому сотруднику этой аптеки, не обязательно тому, кто на смене */}
        <div className="rounded border border-slate-300 p-3">
          <label className="label mb-2">Аванс сотруднику <span className="text-slate-400 font-normal">— необязательно</span></label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="col-span-2">
              <select
                name="avansEmployeeId"
                value={form.avansEmployeeId}
                onChange={handleChange}
                className="input"
                disabled={employees.length === 0}
              >
                <option value="">— кому выдан аванс —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
            <div>
              <input
                type="number"
                name="avans"
                value={form.avans}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="Сумма аванса"
                className="input"
                disabled={!form.avansEmployeeId}
              />
            </div>
          </div>
          {form.avansEmployeeId && parseFloat(form.avans) > 0 && (
            <p className="mt-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
              Будет вычтен из накопленной зарплаты выбранного сотрудника и учтён как расход аптеки и наличные на руках за день.
            </p>
          )}
          {employees.length > 0 && !form.avansEmployeeId && form.avans && parseFloat(form.avans) > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              Выберите сотрудника, которому выдан аванс
            </p>
          )}
        </div>

        {/* Выручка */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Выручка наличными *</label>
            <input
              type="number"
              name="cashRevenue"
              value={form.cashRevenue}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              className="input"
            />
          </div>
          <div>
            <label className="label">Выручка по терминалу *</label>
            <input
              type="number"
              name="terminalRevenue"
              value={form.terminalRevenue}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              className="input"
            />
          </div>
          <div>
            <label className="label">
              Выручка Каспи
              <span className="ml-1 text-slate-400 font-normal">— входит в общую</span>
            </label>
            <input
              type="number"
              name="kaspiRevenue"
              value={form.kaspiRevenue}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="input"
            />
          </div>
        </div>

        {totalRevenue > 0 && (
          <div className="bg-slate-100 border border-slate-300 rounded px-3 py-2 text-sm text-slate-900">
            Итого выручка: <strong>{totalRevenue.toLocaleString('ru-RU')}</strong>
          </div>
        )}

        {/* Дополнительные расходы */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Дополнительные статьи</label>
            <button
              type="button"
              onClick={addExpenseItem}
              className="text-sm text-slate-700 hover:text-slate-900 font-medium flex items-center gap-1"
            >
              + Добавить строку
            </button>
          </div>

          {expenseItems.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-1">
              Нет записей — нажмите «+ Добавить строку»
            </p>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid gap-2 text-xs text-slate-400 font-medium px-6" style={{ gridTemplateColumns: '2rem 7rem 1fr 9rem 1.5rem' }}>
                <span></span>
                <span>Сумма</span>
                <span>Статья *</span>
                <span>Примечание</span>
                <span></span>
              </div>
              {expenseItems.map((item, idx) => (
                <div key={item.id}>
                  {/* Mobile layout */}
                  <div className="sm:hidden bg-slate-50 rounded-md p-3 space-y-2">
                    <div className="flex gap-2 items-center">
                      <span className="text-xs text-slate-400 w-5 shrink-0">{idx + 1}.</span>
                      <input
                        type="number"
                        value={item.amount}
                        onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="Сумма"
                        className="input flex-1"
                        autoFocus={idx === expenseItems.length - 1}
                      />
                      <button
                        type="button"
                        onClick={() => removeExpenseItem(item.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors text-xl leading-none shrink-0"
                        title="Удалить"
                      >
                        ×
                      </button>
                    </div>
                    <select
                      value={item.category}
                      onChange={(e) => updateExpenseItem(item.id, 'category', e.target.value)}
                      className="input w-full"
                      required
                    >
                      <option value="">— статья —</option>
                      <optgroup label="Расходы">
                        {EXPENSE_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>{opt.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Доходы">
                        {INCOME_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>{opt.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    <input
                      type="text"
                      value={item.comment}
                      onChange={(e) => updateExpenseItem(item.id, 'comment', e.target.value)}
                      placeholder="Примечание (необязательно)"
                      className="input w-full"
                    />
                  </div>
                  {/* Desktop layout */}
                  <div className="hidden sm:grid gap-2 items-start" style={{ gridTemplateColumns: '2rem 7rem 1fr 9rem 1.5rem' }}>
                    <span className="text-xs text-slate-400 mt-2.5 text-right pr-1">
                      {idx + 1}.
                    </span>
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)}
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="input"
                      autoFocus={idx === expenseItems.length - 1}
                    />
                    <select
                      value={item.category}
                      onChange={(e) => updateExpenseItem(item.id, 'category', e.target.value)}
                      className="input"
                      required
                    >
                      <option value="">— статья —</option>
                      <optgroup label="Расходы">
                        {EXPENSE_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>{opt.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Доходы">
                        {INCOME_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>{opt.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    <input
                      type="text"
                      value={item.comment}
                      onChange={(e) => updateExpenseItem(item.id, 'comment', e.target.value)}
                      placeholder="необязательно"
                      className="input"
                    />
                    <button
                      type="button"
                      onClick={() => removeExpenseItem(item.id)}
                      className="mt-2 text-slate-300 hover:text-red-500 transition-colors text-lg leading-none"
                      title="Удалить"
                    >
                      ×
                    </button>
                  </div>
                  {item.category === 'pharmaBonus' && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 mt-1 sm:ml-8">
                      Эта сумма пойдёт в расходы и будет автоматически учтена в зарплате сотрудника за месяц.
                    </p>
                  )}
                </div>
              ))}

              {expenseItems.length > 1 && (
                <div className="text-sm text-slate-600 pt-1 pl-8">
                  Итого:{' '}
                  <strong>{totalExpenses.toLocaleString('ru-RU')}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Общий комментарий */}
        <div>
          <label className="label">Общий комментарий за день</label>
          <textarea
            name="generalComment"
            value={form.generalComment}
            onChange={handleChange}
            rows={2}
            placeholder="Необязательно"
            className="input resize-none"
          />
        </div>

        {(totalRevenue > 0 || summaryExpenses > 0 || summaryBonuses > 0 || summaryAdvances > 0) && (
          <div className="card px-3 py-2 bg-slate-50 flex flex-wrap gap-4 text-sm">
            <span>
              Итого:{' '}
              <strong className={grandTotal >= 0 ? 'text-green-700' : 'text-red-700'}>
                {grandTotal.toLocaleString('ru-RU')}
              </strong>
            </span>
            <span>
              Наличными на руках:{' '}
              <strong className={cashNet >= 0 ? 'text-green-700' : 'text-red-700'}>
                {cashNet.toLocaleString('ru-RU')}
              </strong>
            </span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push('/')}
          >
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
