'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Pharmacy { id: number; name: string }
interface ExpenseItem { id: number; amount: number; comment: string | null }

interface RevenueEntry {
  id: number;
  date: string;
  pharmacy: Pharmacy;
  cashRevenue: number;
  terminalRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  expenseItems: ExpenseItem[];
  expenseComment: string | null;
  generalComment: string | null;
  employeeName: string;
  status: string;
}

interface EditExpenseItem { id: number; amount: string; comment: string }

interface EditState {
  pharmacyId: string;
  date: string;
  cashRevenue: string;
  terminalRevenue: string;
  generalComment: string;
  employeeName: string;
  expenseItems: EditExpenseItem[];
}

let nextItemId = 1;
function newItem(): EditExpenseItem { return { id: nextItemId++, amount: '', comment: '' }; }

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU');
}

export default function RevenueListPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Фильтры
  const [filterPharmacy, setFilterPharmacy] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Редактирование
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);

  useEffect(() => {
    fetch('/api/pharmacies').then((r) => r.json()).then(setPharmacies);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ status: 'all' });
    if (filterPharmacy) p.set('pharmacyId', filterPharmacy);
    const res = await fetch(`/api/revenue?${p}`);
    let data: RevenueEntry[] = await res.json();

    // Фильтрация по дате на клиенте (проще, чем доп. API-параметры)
    if (filterFrom) data = data.filter((e) => e.date >= filterFrom);
    if (filterTo)   data = data.filter((e) => e.date <= filterTo + 'T23:59:59');

    setEntries(data);
    setLoading(false);
  }, [filterPharmacy, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  function startEdit(entry: RevenueEntry) {
    setEditingId(entry.id);
    setSaveError('');
    setEditState({
      pharmacyId: String(entry.pharmacy.id),
      date: entry.date.split('T')[0],
      cashRevenue: String(entry.cashRevenue),
      terminalRevenue: String(entry.terminalRevenue),
      generalComment: entry.generalComment ?? '',
      employeeName: entry.employeeName,
      expenseItems: entry.expenseItems.length > 0
        ? entry.expenseItems.map((i) => ({
            id: nextItemId++,
            amount: String(i.amount),
            comment: i.comment ?? '',
          }))
        : [],
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState(null);
    setSaveError('');
  }

  function updateField(field: keyof Omit<EditState, 'expenseItems'>, value: string) {
    setEditState((s) => s ? { ...s, [field]: value } : s);
  }

  function addExpenseItem() {
    setEditState((s) => s ? { ...s, expenseItems: [...s.expenseItems, newItem()] } : s);
  }

  function removeExpenseItem(id: number) {
    setEditState((s) => s ? { ...s, expenseItems: s.expenseItems.filter((i) => i.id !== id) } : s);
  }

  function updateExpenseItem(id: number, field: 'amount' | 'comment', value: string) {
    setEditState((s) =>
      s ? {
        ...s,
        expenseItems: s.expenseItems.map((i) => i.id === id ? { ...i, [field]: value } : i),
      } : s
    );
  }

  async function deleteEntry(id: number) {
    if (!confirm('Удалить запись? Это действие нельзя отменить.')) return;
    await fetch(`/api/revenue/${id}`, { method: 'DELETE' });
    if (editingId === id) cancelEdit();
    load();
  }

  async function saveEdit() {
    if (!editState || editingId === null) return;
    setSaving(true);
    setSaveError('');

    const res = await fetch(`/api/revenue/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pharmacyId: Number(editState.pharmacyId),
        date: editState.date,
        cashRevenue: editState.cashRevenue || '0',
        terminalRevenue: editState.terminalRevenue || '0',
        generalComment: editState.generalComment || null,
        employeeName: editState.employeeName,
        expenseItems: editState.expenseItems
          .filter((i) => parseFloat(i.amount) > 0)
          .map((i) => ({ amount: i.amount, comment: i.comment || null })),
      }),
    });

    if (res.ok) {
      setEditingId(null);
      setEditState(null);
      load();
    } else {
      const d = await res.json();
      setSaveError(d.error || 'Ошибка сохранения');
    }
    setSaving(false);
  }

  const totalExpenses = editState
    ? editState.expenseItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Записи выручки</h1>
        <Link href="/revenue/new" className="btn-primary text-sm">+ Добавить</Link>
      </div>
      <p className="text-gray-500 text-sm mb-5">
        Все введённые бухгалтером записи. Нажмите «Изменить» для редактирования.
      </p>

      {/* Фильтры */}
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="label">Дата с</label>
            <input type="date" className="input" value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Дата по</label>
            <input type="date" className="input" value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Аптека</label>
            <select className="input" value={filterPharmacy}
              onChange={(e) => setFilterPharmacy(e.target.value)}>
              <option value="">Все аптеки</option>
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <button className="btn-secondary w-full" onClick={() => {
              setFilterFrom(''); setFilterTo(''); setFilterPharmacy('');
            }}>
              Сбросить
            </button>
          </div>
        </div>
      </div>

      {/* Форма редактирования */}
      {editingId !== null && editState && (
        <div className="card p-5 mb-5 border-blue-200 border-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Редактирование записи</h2>
            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          {saveError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="col-span-2">
              <label className="label">Аптека</label>
              <select className="input" value={editState.pharmacyId}
                onChange={(e) => updateField('pharmacyId', e.target.value)}>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Дата</label>
              <input type="date" className="input" value={editState.date}
                onChange={(e) => updateField('date', e.target.value)} />
            </div>
            <div>
              <label className="label">Сотрудник</label>
              <input type="text" className="input" value={editState.employeeName}
                onChange={(e) => updateField('employeeName', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="label">Выручка наличными</label>
              <input type="number" min="0" step="0.01" className="input"
                value={editState.cashRevenue}
                onChange={(e) => updateField('cashRevenue', e.target.value)} />
            </div>
            <div>
              <label className="label">Выручка по терминалу</label>
              <input type="number" min="0" step="0.01" className="input"
                value={editState.terminalRevenue}
                onChange={(e) => updateField('terminalRevenue', e.target.value)} />
            </div>
          </div>

          {/* Строки расходов */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Дополнительные расходы</label>
              <button type="button" onClick={addExpenseItem}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                + Добавить расход
              </button>
            </div>
            {editState.expenseItems.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Нет расходов</p>
            ) : (
              <div className="space-y-2">
                {editState.expenseItems.map((item, idx) => (
                  <div key={item.id} className="flex gap-2 items-center">
                    <span className="text-xs text-gray-400 w-4 shrink-0">{idx + 1}.</span>
                    <input type="number" min="0" step="0.01" placeholder="Сумма"
                      className="input w-32 shrink-0" value={item.amount}
                      onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)} />
                    <input type="text" placeholder="Комментарий"
                      className="input flex-1" value={item.comment}
                      onChange={(e) => updateExpenseItem(item.id, 'comment', e.target.value)} />
                    <button type="button" onClick={() => removeExpenseItem(item.id)}
                      className="text-gray-300 hover:text-red-500 text-xl leading-none transition-colors">
                      ×
                    </button>
                  </div>
                ))}
                {editState.expenseItems.length > 1 && (
                  <p className="text-sm text-gray-600 pl-6">
                    Итого расходов: <strong>{totalExpenses.toLocaleString('ru-RU')}</strong>
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mb-4">
            <label className="label">Общий комментарий</label>
            <textarea rows={2} className="input resize-none"
              value={editState.generalComment}
              onChange={(e) => updateField('generalComment', e.target.value)} />
          </div>

          <div className="flex gap-3">
            <button className="btn-primary" onClick={saveEdit} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
            <button className="btn-secondary" onClick={cancelEdit}>Отмена</button>
          </div>
        </div>
      )}

      {/* Таблица записей */}
      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 text-sm">
          Нет записей за выбранный период
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="th">Дата</th>
                  <th className="th">Аптека</th>
                  <th className="th text-right">Наличные</th>
                  <th className="th text-right">Терминал</th>
                  <th className="th text-right">Выручка</th>
                  <th className="th text-right">Расходы</th>
                  <th className="th">Сотрудник</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <>
                    <tr
                      key={entry.id}
                      className={`${editingId === entry.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="td">{fmtDate(entry.date)}</td>
                      <td className="td font-medium">{entry.pharmacy.name}</td>
                      <td className="td text-right">{fmt(entry.cashRevenue)}</td>
                      <td className="td text-right">{fmt(entry.terminalRevenue)}</td>
                      <td className="td text-right font-semibold text-blue-700">
                        {fmt(entry.totalRevenue)}
                      </td>
                      <td className="td text-right text-red-600">
                        {entry.additionalExpenses > 0 ? fmt(entry.additionalExpenses) : '—'}
                      </td>
                      <td className="td text-gray-500">{entry.employeeName}</td>
                      <td className="td">
                        {editingId === entry.id ? (
                          <span className="text-xs text-blue-600 font-medium">Редактируется</span>
                        ) : (
                          <div className="flex gap-1">
                            <button
                              className="btn-secondary text-xs"
                              onClick={() => startEdit(entry)}
                            >
                              Изменить
                            </button>
                            <button
                              className="btn-danger text-xs"
                              onClick={() => deleteEntry(entry.id)}
                            >
                              Удалить
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Строки расходов под записью */}
                    {entry.expenseItems.length > 0 && (
                      <tr key={`${entry.id}-exp`} className="bg-orange-50">
                        <td colSpan={8} className="px-4 py-1.5">
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                            <span className="text-xs font-medium text-orange-700 shrink-0">
                              Расходы:
                            </span>
                            {entry.expenseItems.map((item) => (
                              <span key={item.id} className="text-xs text-orange-800">
                                <strong>{fmt(item.amount)}</strong>
                                {item.comment && (
                                  <span className="text-orange-600"> — {item.comment}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Общий комментарий */}
                    {entry.generalComment && (
                      <tr key={`${entry.id}-note`} className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-1 text-xs text-gray-400">
                          {entry.generalComment}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Итого по отфильтрованным записям */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-6 text-sm">
            <span className="text-gray-500">Итого по выбранным записям:</span>
            <span>
              Выручка:{' '}
              <strong className="text-blue-700">
                {fmt(entries.reduce((s, e) => s + e.totalRevenue, 0))}
              </strong>
            </span>
            <span>
              Расходы:{' '}
              <strong className="text-red-600">
                {fmt(entries.reduce((s, e) => s + e.additionalExpenses, 0))}
              </strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
