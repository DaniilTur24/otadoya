'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MONTHLY_REPORT_ROWS, MONTHLY_EXPENSE_KEYS } from '@/lib/monthly-report-fields';
import { SHIFT_OPTIONS } from '@/lib/shift-types';

interface Pharmacy {
  id: number;
  name: string;
}

interface Employee {
  id: number;
  name: string;
}

interface ExpenseItem {
  id: number;
  amount: string;
  category: string;
  comment: string;
}

const EXPENSE_CATEGORY_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) => !row.section && (MONTHLY_EXPENSE_KEYS as readonly string[]).includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

let nextId = 1;

function emptyItem(): ExpenseItem {
  return { id: nextId++, amount: '', category: '', comment: '' };
}

export default function NewRevenuePage() {
  const router = useRouter();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
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
  });

  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/pharmacies').then((r) => r.json()),
      fetch('/api/employees?isActive=true').then((r) => r.json()),
    ]).then(([pharmas, emps]) => {
      setPharmacies(pharmas);
      setEmployees(emps);
    });
  }, []);

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

  const totalExpenses = expenseItems.reduce(
    (sum, i) => sum + (parseFloat(i.amount) || 0),
    0
  );

  const totalRevenue =
    (parseFloat(form.cashRevenue) || 0) +
    (parseFloat(form.terminalRevenue) || 0) +
    (parseFloat(form.kaspiRevenue) || 0);

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
        expenseItems: validItems.map((i) => ({
          amount: i.amount,
          category: i.category,
          comment: i.comment || null,
        })),
        generalComment: form.generalComment || null,
      }),
    });

    if (res.ok) {
      setSuccess(true);
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
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Добавить дневную выручку</h1>
      <p className="text-gray-500 text-sm mb-6">
        Бухгалтер вводит данные с бумажного листочка сотрудника. Запись сразу сохраняется в отчёт.
      </p>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-800 text-sm">
          Запись сохранена.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        {/* Аптека и дата */}
        <div className="grid grid-cols-2 gap-4">
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

          <div>{/* пустая ячейка для выравнивания */}</div>
        </div>

        {/* Сотрудник и смена */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Сотрудник *</label>
            {employees.length > 0 ? (
              <>
                <select
                  name="employeeId"
                  value={form.employeeId}
                  onChange={handleChange}
                  required
                  className="input"
                >
                  <option value="">— выберите из списка —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Нет нужного?{' '}
                  <a href="/employees" target="_blank" className="text-blue-500 hover:underline">
                    Добавить сотрудника
                  </a>
                </p>
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Список сотрудников пуст.{' '}
                <a href="/employees" target="_blank" className="font-medium underline">
                  Добавьте сотрудников
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

        {/* Выручка */}
        <div className="grid grid-cols-3 gap-4">
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
              <span className="ml-1 text-gray-400 font-normal">— входит в общую</span>
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
          <div className="bg-blue-50 rounded-md px-4 py-2 text-sm text-blue-800">
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
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              + Добавить строку
            </button>
          </div>

          {expenseItems.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-1">
              Нет записей — нажмите «+ Добавить строку»
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-2 text-xs text-gray-400 font-medium px-6" style={{ gridTemplateColumns: '2rem 7rem 1fr 9rem 1.5rem' }}>
                <span></span>
                <span>Сумма</span>
                <span>Статья *</span>
                <span>Примечание</span>
                <span></span>
              </div>
              {expenseItems.map((item, idx) => (
                <div key={item.id}>
                  <div className="grid gap-2 items-start" style={{ gridTemplateColumns: '2rem 7rem 1fr 9rem 1.5rem' }}>
                    <span className="text-xs text-gray-400 mt-2.5 text-right pr-1">
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
                      {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                      ))}
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
                      className="mt-2 text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                      title="Удалить"
                    >
                      ×
                    </button>
                  </div>
                  {item.category === 'pharmaBonus' && (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 mt-1 ml-8">
                      Эта сумма пойдёт в расходы и будет автоматически учтена в зарплате сотрудника за месяц.
                    </p>
                  )}
                </div>
              ))}

              {expenseItems.length > 1 && (
                <div className="text-sm text-gray-600 pt-1 pl-8">
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
