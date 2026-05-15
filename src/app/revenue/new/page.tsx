'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Pharmacy {
  id: number;
  name: string;
}

interface ExpenseItem {
  id: number;
  amount: string;
  comment: string;
}

let nextId = 1;

function emptyItem(): ExpenseItem {
  return { id: nextId++, amount: '', comment: '' };
}

export default function NewRevenuePage() {
  const router = useRouter();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    pharmacyId: '',
    date: today,
    cashRevenue: '',
    terminalRevenue: '',
    bonusRevenue: '',
    generalComment: '',
    employeeName: '',
  });

  // Динамический список дополнительных расходов
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);

  useEffect(() => {
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then(setPharmacies);
  }, []);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function addExpenseItem() {
    setExpenseItems((items) => [...items, emptyItem()]);
  }

  function removeExpenseItem(id: number) {
    setExpenseItems((items) => items.filter((i) => i.id !== id));
  }

  function updateExpenseItem(id: number, field: 'amount' | 'comment', value: string) {
    setExpenseItems((items) =>
      items.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );
  }

  // Сумма всех расходов
  const totalExpenses = expenseItems.reduce(
    (sum, i) => sum + (parseFloat(i.amount) || 0),
    0
  );

  const totalRevenue =
    (parseFloat(form.cashRevenue) || 0) +
    (parseFloat(form.terminalRevenue) || 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        pharmacyId: Number(form.pharmacyId),
        cashRevenue: form.cashRevenue || '0',
        terminalRevenue: form.terminalRevenue || '0',
        expenseItems: expenseItems
          .filter((i) => parseFloat(i.amount) > 0)
          .map((i) => ({ amount: i.amount, comment: i.comment || null })),
      }),
    });

    if (res.ok) {
      setSuccess(true);
      setForm({
        pharmacyId: form.pharmacyId,
        date: today,
        cashRevenue: '',
        terminalRevenue: '',
        bonusRevenue: '',
        generalComment: '',
        employeeName: form.employeeName,
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
    <div className="max-w-xl">
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
        {/* Аптека, дата, сотрудник */}
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
          </div>

          <div>
            <label className="label">Имя сотрудника *</label>
            <input
              type="text"
              name="employeeName"
              value={form.employeeName}
              onChange={handleChange}
              required
              placeholder="Иванова А.В."
              className="input"
            />
          </div>
        </div>

        {/* Выручка */}
        <div className="grid grid-cols-2 gap-4">
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
          <div className="col-span-2">
            <label className="label">
              Бонусы фарм и зав
              <span className="ml-1 text-gray-400 font-normal">
                — учитываются отдельно в закрытии месяца
              </span>
            </label>
            <input
              type="number"
              name="bonusRevenue"
              value={form.bonusRevenue}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="input max-w-xs"
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
            <label className="label mb-0">Дополнительные расходы</label>
            <button
              type="button"
              onClick={addExpenseItem}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              + Добавить расход
            </button>
          </div>

          {expenseItems.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-1">
              Нет расходов — нажмите «+ Добавить расход»
            </p>
          ) : (
            <div className="space-y-2">
              {expenseItems.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-start">
                  <span className="text-xs text-gray-400 mt-2.5 w-4 shrink-0">
                    {idx + 1}.
                  </span>
                  <input
                    type="number"
                    value={item.amount}
                    onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="Сумма"
                    className="input w-32 shrink-0"
                    autoFocus={idx === expenseItems.length - 1}
                  />
                  <input
                    type="text"
                    value={item.comment}
                    onChange={(e) => updateExpenseItem(item.id, 'comment', e.target.value)}
                    placeholder="Комментарий (что за расход?)"
                    className="input flex-1"
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
              ))}

              {expenseItems.length > 1 && (
                <div className="text-sm text-gray-600 pt-1 pl-6">
                  Итого расходов:{' '}
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
