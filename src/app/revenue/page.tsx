'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MONTHLY_REPORT_ROWS, MONTHLY_EXPENSE_KEYS, monthlyFieldType } from '@/lib/monthly-report-fields';
import { SHIFT_OPTIONS, SHIFT_TYPE_LABELS } from '@/lib/shift-types';
import { ATTENDANCE_BASED_TYPES } from '@/lib/employee-types';

const EXPENSE_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) => !row.section && (MONTHLY_EXPENSE_KEYS as readonly string[]).includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

const INCOME_OPTIONS = MONTHLY_REPORT_ROWS.filter(
  (row) =>
    !row.section &&
    row.rowType === 'income' &&
    row.source !== 'calc' &&
    !['retailRevenue', 'kaspiRevenue', 'wholesaleRevenue'].includes(row.key)
).map((row) => ({ key: row.key, label: row.label }));

interface Pharmacy { id: number; name: string }
interface Employee { id: number; name: string; employeeType: string; fiveDayViaAttendance?: boolean }

interface ExpenseItem {
  id: number;
  amount: number;
  category: string | null;
  comment: string | null;
  employeeId: number | null;
}

interface RevenueEntry {
  id: number;
  date: string;
  pharmacy: Pharmacy;
  cashRevenue: number;
  terminalRevenue: number;
  kaspiRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  expenseItems: ExpenseItem[];
  generalComment: string | null;
  employeeId: number | null;
  employeeName: string;
  shiftType: string | null;
  status: string;
  excludedFromReport: boolean;
}

interface EditExpenseItem { id: number; amount: string; category: string; comment: string; employeeId: string }

interface EditState {
  pharmacyId: string;
  date: string;
  cashRevenue: string;
  terminalRevenue: string;
  kaspiRevenue: string;
  generalComment: string;
  employeeId: string;
  employeeName: string;
  shiftType: string;
  expenseItems: EditExpenseItem[];
}

let nextItemId = 1;
function newItem(): EditExpenseItem { return { id: nextItemId++, amount: '', category: '', comment: '', employeeId: '' }; }

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU');
}

function pharmaBonusSum(items: ExpenseItem[]) {
  return items.filter((i) => i.category === 'pharmaBonus').reduce((s, i) => s + i.amount, 0);
}
function advanceSum(items: ExpenseItem[]) {
  return items.filter((i) => i.category === 'employeeAdvance').reduce((s, i) => s + i.amount, 0);
}
function surchargeSum(items: ExpenseItem[]) {
  return items.filter((i) => i.category === 'employeeSurcharge').reduce((s, i) => s + i.amount, 0);
}
const EXCLUDED_FROM_GENERIC_SUMS = new Set(['pharmaBonus', 'employeeAdvance', 'employeeSurcharge']);
// Статьи с rowType 'income' — доходные, прибавляются к выручке
function incomeItemsSum(items: ExpenseItem[]) {
  return items
    .filter((i) => !EXCLUDED_FROM_GENERIC_SUMS.has(i.category ?? '') && monthlyFieldType(i.category) === 'income')
    .reduce((s, i) => s + i.amount, 0);
}
// Остальные статьи (expense / neutral) — расходы
function expenseItemsSum(items: ExpenseItem[]) {
  return items
    .filter((i) => !EXCLUDED_FROM_GENERIC_SUMS.has(i.category ?? '') && monthlyFieldType(i.category) !== 'income')
    .reduce((s, i) => s + i.amount, 0);
}

const ROW_LABEL: Record<string, string> = Object.fromEntries(
  MONTHLY_REPORT_ROWS.filter((r) => !r.section).map((r) => [r.key, r.label])
);

export default function RevenueListPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [pendingEntries, setPendingEntries] = useState<RevenueEntry[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [moderating, setModerating] = useState<number | null>(null);
  const [moderateComment, setModerateComment] = useState('');
  const [showModeration, setShowModeration] = useState(true);

  const [filterPharmacy, setFilterPharmacy] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);

  const [tooltipEntry, setTooltipEntry] = useState<RevenueEntry | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Сотрудники с табельной оплатой (manager_fixed/cleaner/office/pharmacy_manager) не привязаны
  // к смене в записи выручки — их зарплата считается только через табель посещаемости.
  const shiftEligibleEmployees = employees.filter((e) => !ATTENDANCE_BASED_TYPES.has(e.employeeType));
  const editSelectedEmployee = editState ? employees.find((e) => e.id === Number(editState.employeeId)) : undefined;
  const isEditFiveDayEmployee = Boolean(editSelectedEmployee?.fiveDayViaAttendance);

  useEffect(() => {
    fetch('/api/pharmacies').then((r) => r.json()).then(setPharmacies);
    fetch('/api/employees?isActive=true').then((r) => r.json()).then(setEmployees);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const roleRes = await fetch('/api/auth/me').then((r) => r.json());
    const currentRole: string = roleRes.role ?? '';
    setRole(currentRole);

    const isModeratorRole = currentRole === 'admin' || currentRole === 'bookkeeper';

    const fetchAll = fetch(`/api/revenue?status=all${filterPharmacy ? `&pharmacyId=${filterPharmacy}` : ''}`);
    const fetchPending = isModeratorRole ? fetch('/api/revenue?status=pending') : Promise.resolve(null);

    const [allRes, pendingRes] = await Promise.all([fetchAll, fetchPending]);

    let data: RevenueEntry[] = await allRes.json();
    // Для admin/bookkeeper pending записи показываются только в панели модерации, не в основной таблице
    if (isModeratorRole) data = data.filter((e) => e.status !== 'pending');

    if (filterFrom) data = data.filter((e) => e.date >= filterFrom);
    if (filterTo)   data = data.filter((e) => e.date <= filterTo + 'T23:59:59');
    setEntries(data);
    setSelectedIds(new Set());

    if (pendingRes) {
      const pending: RevenueEntry[] = await pendingRes.json();
      setPendingEntries(pending);
    } else {
      setPendingEntries([]);
    }
    setLoading(false);
  }, [filterPharmacy, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  async function approveEntry(id: number) {
    await fetch(`/api/revenue/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookkeeperComment: moderateComment || null }),
    });
    setModerating(null);
    setModerateComment('');
    load();
  }

  async function rejectEntry(id: number) {
    if (!moderateComment.trim()) {
      alert('Укажите причину отклонения');
      return;
    }
    await fetch(`/api/revenue/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookkeeperComment: moderateComment }),
    });
    setModerating(null);
    setModerateComment('');
    load();
  }

  function startEdit(entry: RevenueEntry) {
    setEditingId(entry.id);
    setSaveError('');
    setEditState({
      pharmacyId: String(entry.pharmacy.id),
      date: entry.date.split('T')[0],
      cashRevenue: String(entry.cashRevenue),
      terminalRevenue: String(entry.terminalRevenue),
      kaspiRevenue: String(entry.kaspiRevenue ?? 0),
      generalComment: entry.generalComment ?? '',
      employeeId: entry.employeeId ? String(entry.employeeId) : '',
      employeeName: entry.employeeName,
      shiftType: entry.shiftType ?? '',
      expenseItems: entry.expenseItems.length > 0
        ? entry.expenseItems.map((i) => ({
            id: nextItemId++,
            amount: String(i.amount),
            category: i.category ?? '',
            comment: i.comment ?? '',
            employeeId: i.employeeId ? String(i.employeeId) : '',
          }))
        : [],
    });
  }

  function cancelEdit() { setEditingId(null); setEditState(null); setSaveError(''); }

  function updateField(field: keyof Omit<EditState, 'expenseItems'>, value: string) {
    setEditState((s) => {
      if (!s) return s;
      const updated = { ...s, [field]: value };
      if (field === 'employeeId') {
        const emp = employees.find((e) => e.id === Number(value));
        updated.employeeName = emp ? emp.name : s.employeeName;
        // У пятидневщика зарплата считается по табелю — смену в записи выручки ему не назначаем
        if (emp?.fiveDayViaAttendance) {
          updated.shiftType = '';
        }
      }
      return updated;
    });
  }

  function addExpenseItem() {
    setEditState((s) => s ? { ...s, expenseItems: [...s.expenseItems, newItem()] } : s);
  }
  function removeExpenseItem(id: number) {
    setEditState((s) => s ? { ...s, expenseItems: s.expenseItems.filter((i) => i.id !== id) } : s);
  }
  function updateExpenseItem(id: number, field: 'amount' | 'category' | 'comment' | 'employeeId', value: string) {
    setEditState((s) =>
      s ? { ...s, expenseItems: s.expenseItems.map((i) => i.id === id ? { ...i, [field]: value } : i) } : s
    );
  }

  async function deleteEntry(id: number) {
    if (!confirm('Удалить запись? Это действие нельзя отменить.')) return;
    await fetch(`/api/revenue/${id}`, { method: 'DELETE' });
    if (editingId === id) cancelEdit();
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
      s.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))
    );
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Удалить ${selectedIds.size} выбранных записей? Это действие нельзя отменить.`)) return;
    await Promise.all(
      Array.from(selectedIds).map((id) => fetch(`/api/revenue/${id}`, { method: 'DELETE' }))
    );
    if (editingId !== null && selectedIds.has(editingId)) cancelEdit();
    load();
  }

  async function saveEdit() {
    if (!editState || editingId === null) return;
    setSaving(true);
    setSaveError('');

    const validItems = editState.expenseItems.filter((i) => parseFloat(i.amount) > 0);
    const missingCategory = validItems.find((i) => !i.category);
    if (missingCategory) {
      setSaveError('Выберите категорию расхода для каждой строки');
      setSaving(false);
      return;
    }
    const missingAdvanceEmployee = validItems.find((i) => i.category === 'employeeAdvance' && !i.employeeId);
    if (missingAdvanceEmployee) {
      setSaveError('Выберите сотрудника, которому выдан аванс');
      setSaving(false);
      return;
    }
    const missingSurchargeEmployee = validItems.find((i) => i.category === 'employeeSurcharge' && !i.employeeId);
    if (missingSurchargeEmployee) {
      setSaveError('Выберите сотрудника, которому положена доплата');
      setSaving(false);
      return;
    }

    const employeeName = editState.employeeName.trim();
    if (!employeeName) {
      setSaveError('Выберите сотрудника из списка');
      setSaving(false);
      return;
    }

    const res = await fetch(`/api/revenue/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pharmacyId: Number(editState.pharmacyId),
        date: editState.date,
        cashRevenue: editState.cashRevenue || '0',
        terminalRevenue: editState.terminalRevenue || '0',
        kaspiRevenue: editState.kaspiRevenue || '0',
        generalComment: editState.generalComment || null,
        employeeId: editState.employeeId ? Number(editState.employeeId) : null,
        employeeName,
        shiftType: editState.shiftType || null,
        expenseItems: validItems.map((i) => ({
          amount: i.amount,
          category: i.category || null,
          comment: i.comment || null,
          employeeId: (i.category === 'employeeAdvance' || i.category === 'employeeSurcharge') && i.employeeId ? Number(i.employeeId) : null,
        })),
      }),
    });

    if (res.ok) { cancelEdit(); load(); }
    else { const d = await res.json(); setSaveError(d.error || 'Ошибка сохранения'); }
    setSaving(false);
  }

  const totalExpenses = editState
    ? editState.expenseItems.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    : 0;

  const totalRevenue =
    editState
      ? (parseFloat(editState.cashRevenue) || 0) +
        (parseFloat(editState.terminalRevenue) || 0) +
        (parseFloat(editState.kaspiRevenue) || 0)
      : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-900">Записи выручки</h1>
        <Link href="/revenue/new" className="btn-primary text-sm">+ Добавить</Link>
      </div>
      <p className="text-slate-500 text-sm mb-4">
        Все введённые бухгалтером записи. Нажмите «Изменить» для редактирования.
      </p>

      {/* Панель модерации — только для admin/bookkeeper */}
      {(role === 'admin' || role === 'bookkeeper') && pendingEntries.length > 0 && (
        <div className="mb-5">
          <button
            className="flex items-center gap-2 mb-2 text-sm font-semibold text-amber-700"
            onClick={() => setShowModeration((v) => !v)}
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500 text-white text-xs font-bold">
              {pendingEntries.length}
            </span>
            На проверке
            <span className="text-slate-400 font-normal">{showModeration ? '▲' : '▼'}</span>
          </button>

          {showModeration && (
            <div className="card overflow-hidden border-amber-200 border">
              <table className="w-full">
                <thead className="bg-amber-50 border-b border-amber-200">
                  <tr>
                    <th className="th bg-amber-50">Дата</th>
                    <th className="th bg-amber-50">Аптека</th>
                    <th className="th bg-amber-50">Сотрудник</th>
                    <th className="th bg-amber-50 text-right">Нал.</th>
                    <th className="th bg-amber-50 text-right">Терминал</th>
                    <th className="th bg-amber-50 text-right">Каспи</th>
                    <th className="th bg-amber-50 text-right">Расходы</th>
                    <th className="th bg-amber-50"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {pendingEntries.map((entry) => {
                    const expenses = expenseItemsSum(entry.expenseItems);
                    const isExpanded = moderating === entry.id;
                    return (
                      <React.Fragment key={entry.id}>
                        <tr className="bg-amber-50/40">
                          <td className="td">{fmtDate(entry.date)}</td>
                          <td className="td font-medium">{entry.pharmacy.name}</td>
                          <td className="td text-slate-600">{entry.employeeName}</td>
                          <td className="td text-right text-green-700">{fmt(entry.cashRevenue)}</td>
                          <td className="td text-right text-green-700">{fmt(entry.terminalRevenue)}</td>
                          <td className="td text-right text-green-700">{entry.kaspiRevenue > 0 ? fmt(entry.kaspiRevenue) : '—'}</td>
                          <td className="td text-right text-red-600">{expenses > 0 ? fmt(expenses) : '—'}</td>
                          <td className="td">
                            {isExpanded ? (
                              <button
                                className="text-xs text-slate-400 hover:text-slate-600"
                                onClick={() => { setModerating(null); setModerateComment(''); }}
                              >
                                Закрыть
                              </button>
                            ) : (
                              <button
                                className="btn-warning text-xs"
                                onClick={() => { setModerating(entry.id); setModerateComment(''); }}
                              >
                                Проверить
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${entry.id}-expand`} className="bg-white">
                            <td colSpan={8} className="px-4 py-3">
                              {entry.expenseItems.length > 0 && (
                                <div className="mb-3 text-sm">
                                  <p className="font-medium text-slate-700 mb-1">Расходы:</p>
                                  <ul className="space-y-0.5">
                                    {entry.expenseItems.map((item) => (
                                      <li key={item.id} className="text-slate-600 flex gap-2">
                                        <span className="text-red-600">{fmt(item.amount)}</span>
                                        <span>{ROW_LABEL[item.category ?? ''] ?? item.category ?? '—'}</span>
                                        {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {entry.generalComment && (
                                <p className="text-sm text-slate-500 italic mb-3">{entry.generalComment}</p>
                              )}
                              <div className="flex flex-col sm:flex-row gap-2 items-start">
                                <input
                                  type="text"
                                  className="input flex-1"
                                  placeholder="Комментарий бухгалтера (обязателен при отклонении)"
                                  value={moderateComment}
                                  onChange={(e) => setModerateComment(e.target.value)}
                                />
                                <div className="flex gap-2 shrink-0">
                                  <button
                                    className="btn-success text-sm"
                                    onClick={() => approveEntry(entry.id)}
                                  >
                                    Подтвердить
                                  </button>
                                  <button
                                    className="btn-danger text-sm"
                                    onClick={() => rejectEntry(entry.id)}
                                  >
                                    Отклонить
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Фильтры */}
      <div className="card p-3 mb-4">
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
            <button className="btn-warning w-full" onClick={() => {
              setFilterFrom(''); setFilterTo(''); setFilterPharmacy('');
            }}>
              Сбросить
            </button>
          </div>
        </div>
      </div>

      {/* Форма редактирования */}
      {editingId !== null && editState && (
        <div className="card p-4 mb-4 border-slate-400 border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Редактирование записи</h2>
            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>

          {saveError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {saveError}
            </div>
          )}

          {/* Аптека и дата */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="col-span-2 sm:col-span-1">
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
          </div>

          {/* Сотрудник и смена */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="label">Сотрудник</label>
              {shiftEligibleEmployees.length > 0 ? (
                <>
                  <select className="input" value={editState.employeeId}
                    onChange={(e) => updateField('employeeId', e.target.value)} required>
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
                  Нет сотрудников со сменной оплатой.{' '}
                  <a href="/employees" target="_blank" className="font-medium underline">
                    Добавить сотрудников
                  </a>
                </div>
              )}
            </div>
            <div>
              <label className="label">Тип смены</label>
              <select className="input" value={editState.shiftType}
                onChange={(e) => updateField('shiftType', e.target.value)}
                disabled={isEditFiveDayEmployee}>
                <option value="">— не указан —</option>
                {SHIFT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {isEditFiveDayEmployee ? (
                <p className="mt-1 text-xs text-slate-400">
                  У этого сотрудника пятидневка — зарплата считается по табелю посещаемости, смена здесь не назначается
                </p>
              ) : !editState.shiftType && (
                <p className="mt-1 text-xs text-amber-600">Без типа смены зарплата не рассчитается</p>
              )}
            </div>
          </div>

          {/* Выручка */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="label">Наличные</label>
              <input type="number" min="0" step="0.01" className="input"
                value={editState.cashRevenue}
                onChange={(e) => updateField('cashRevenue', e.target.value)} />
            </div>
            <div>
              <label className="label">Терминал</label>
              <input type="number" min="0" step="0.01" className="input"
                value={editState.terminalRevenue}
                onChange={(e) => updateField('terminalRevenue', e.target.value)} />
            </div>
            <div>
              <label className="label">
                Каспи
                <span className="ml-1 text-slate-400 font-normal text-xs">— входит в общую</span>
              </label>
              <input type="number" min="0" step="0.01" className="input"
                value={editState.kaspiRevenue}
                onChange={(e) => updateField('kaspiRevenue', e.target.value)} />
            </div>
          </div>

          {totalRevenue > 0 && (
            <div className="bg-slate-100 border border-slate-300 rounded px-3 py-2 text-sm text-slate-900 mb-3">
              Итого выручка: <strong>{totalRevenue.toLocaleString('ru-RU')}</strong>
            </div>
          )}

          {/* Дополнительные статьи */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Дополнительные статьи</label>
              <button type="button" onClick={addExpenseItem}
                className="text-sm text-slate-700 hover:text-slate-900 font-medium">
                + Добавить строку
              </button>
            </div>
            {editState.expenseItems.length === 0 ? (
              <p className="text-sm text-slate-400 italic">Нет записей</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid gap-2 text-xs text-slate-400 font-medium px-5"
                  style={{ gridTemplateColumns: '1.5rem 6rem 1fr 8rem 1.5rem' }}>
                  <span></span><span>Сумма</span><span>Статья *</span><span>Примечание</span><span></span>
                </div>
                {editState.expenseItems.map((item, idx) => (
                  <div key={item.id}>
                    <div className="grid gap-2 items-start"
                      style={{ gridTemplateColumns: '1.5rem 6rem 1fr 8rem 1.5rem' }}>
                      <span className="text-xs text-slate-400 mt-2.5 text-right pr-1">{idx + 1}.</span>
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        className="input" value={item.amount}
                        onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)} />
                      <select className="input" value={item.category} required
                        onChange={(e) => updateExpenseItem(item.id, 'category', e.target.value)}>
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
                      <input type="text" placeholder="необязательно"
                        className="input" value={item.comment}
                        onChange={(e) => updateExpenseItem(item.id, 'comment', e.target.value)} />
                      <button type="button" onClick={() => removeExpenseItem(item.id)}
                        className="mt-2 text-slate-300 hover:text-red-500 transition-colors text-lg leading-none">
                        ×
                      </button>
                    </div>
                    {item.category === 'pharmaBonus' && (
                      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 mt-1 ml-5">
                        Эта сумма пойдёт в расходы и будет учтена в зарплате сотрудника за месяц.
                      </p>
                    )}
                    {item.category === 'employeeAdvance' && (
                      <div className="mt-1 ml-5 space-y-1">
                        <select className="input" value={item.employeeId} required
                          onChange={(e) => updateExpenseItem(item.id, 'employeeId', e.target.value)}>
                          <option value="">— кому выдан аванс —</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                          Эта сумма пойдёт в расходы и будет вычтена из накопленной зарплаты сотрудника за месяц.
                        </p>
                      </div>
                    )}
                    {item.category === 'employeeSurcharge' && (
                      <div className="mt-1 ml-5 space-y-1">
                        <select className="input" value={item.employeeId} required
                          onChange={(e) => updateExpenseItem(item.id, 'employeeId', e.target.value)}>
                          <option value="">— кому доплата —</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                          Эта сумма пойдёт в расходы и прибавится к зарплате сотрудника за месяц. В статистику бонусов не входит.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {editState.expenseItems.length > 1 && (
                  <p className="text-sm text-slate-600 pl-5 pt-1">
                    Итого: <strong>{totalExpenses.toLocaleString('ru-RU')}</strong>
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
              {saving && <span className="spinner" />}{saving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
            <button className="btn-secondary" onClick={cancelEdit}>Отмена</button>
          </div>
        </div>
      )}

      {/* Таблица записей */}
      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">
          Нет записей за выбранный период
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th w-8">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={entries.length > 0 && selectedIds.size === entries.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="th">Дата</th>
                  <th className="th">Аптека</th>
                  <th className="th text-right">Наличные</th>
                  <th className="th text-right">Терминал</th>
                  <th className="th text-right">Каспи</th>
                  <th className="th text-right">Доп. доходы</th>
                  <th className="th text-right">Бонусы</th>
                  <th className="th text-right">Авансы</th>
                  <th className="th text-right">Доплаты</th>
                  <th className="th text-right">Выручка</th>
                  <th className="th text-right">Расходы</th>
                  <th className="th">Сотрудник</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => {
                  const bonuses    = pharmaBonusSum(entry.expenseItems);
                  const advances   = advanceSum(entry.expenseItems);
                  const surcharges = surchargeSum(entry.expenseItems);
                  const incomes  = incomeItemsSum(entry.expenseItems);
                  const expenses = expenseItemsSum(entry.expenseItems);
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className={editingId === entry.id ? 'bg-slate-100' : 'hover:bg-slate-50'}
                        onMouseEnter={(e) => {
                          if (entry.expenseItems.some(i => i.category !== 'pharmaBonus') || entry.generalComment) {
                            setTooltipEntry(entry);
                            setTooltipPos({ x: e.clientX, y: e.clientY });
                          }
                        }}
                        onMouseLeave={() => setTooltipEntry(null)}>
                        <td className="td">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={selectedIds.has(entry.id)}
                            onChange={() => toggleSelect(entry.id)}
                          />
                        </td>
                        <td className="td">{fmtDate(entry.date)}</td>
                        <td className="td font-medium">{entry.pharmacy.name}</td>
                        <td className="td text-right text-green-700">{fmt(entry.cashRevenue)}</td>
                        <td className="td text-right text-green-700">{fmt(entry.terminalRevenue)}</td>
                        <td className="td text-right text-green-700">
                          {entry.kaspiRevenue > 0 ? fmt(entry.kaspiRevenue) : '—'}
                        </td>
                        <td className="td text-right text-green-700">
                          {incomes > 0 ? fmt(incomes) : '—'}
                        </td>
                        <td className="td text-right text-red-600">
                          {bonuses > 0 ? fmt(bonuses) : '—'}
                        </td>
                        <td className="td text-right text-red-600">
                          {advances > 0 ? fmt(advances) : '—'}
                        </td>
                        <td className="td text-right text-red-600">
                          {surcharges > 0 ? fmt(surcharges) : '—'}
                        </td>
                        <td className="td text-right font-semibold text-green-700">
                          {fmt(entry.totalRevenue)}
                        </td>
                        <td className="td text-right text-red-600">
                          {expenses > 0 ? fmt(expenses) : '—'}
                        </td>
                        <td className="td text-slate-500">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{entry.employeeName}</span>
                            {entry.excludedFromReport && (
                              <button
                                className="text-xs px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                                title="Нажмите чтобы включить в отчёт за этот месяц"
                                onClick={async () => {
                                  const d = new Date(entry.date);
                                  const year = d.getFullYear();
                                  const month = d.getMonth() + 1;
                                  const { isClosed } = await fetch(`/api/months/close?year=${year}&month=${month}`).then((r) => r.json());
                                  if (isClosed) {
                                    alert('Месяц закрыт. Чтобы включить эту запись в отчёт, сначала откройте месяц в разделе «Закрытие месяца».');
                                    return;
                                  }
                                  await fetch(`/api/revenue/${entry.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ excludedFromReport: false }),
                                  });
                                  load();
                                }}
                              >
                                не учитывается
                              </button>
                            )}
                          </div>
                          {entry.shiftType && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              entry.shiftType === 'full_day'
                                ? 'bg-slate-200 text-slate-800'
                                : 'bg-slate-100 text-slate-800'
                            }`}>
                              {SHIFT_TYPE_LABELS[entry.shiftType] ?? entry.shiftType}
                            </span>
                          )}
                        </td>
                        <td className="td">
                          {editingId === entry.id ? (
                            <span className="text-xs text-slate-700 font-medium">Редактируется</span>
                          ) : (
                            <div className="flex gap-1">
                              <button className="btn-secondary text-xs" onClick={() => startEdit(entry)}>
                                Изменить
                              </button>
                              <button className="btn-danger text-xs" onClick={() => deleteEntry(entry.id)}>
                                Удалить
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>

                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Итого */}
          {(() => {
            const totalRevenue  = entries.reduce((s, e) => s + e.totalRevenue, 0);
            const totalCash     = entries.reduce((s, e) => s + e.cashRevenue, 0);
            const totalIncomes  = entries.reduce((s, e) => s + incomeItemsSum(e.expenseItems), 0);
            const totalBonuses  = entries.reduce((s, e) => s + pharmaBonusSum(e.expenseItems), 0);
            const totalAdvances = entries.reduce((s, e) => s + advanceSum(e.expenseItems), 0);
            const totalSurcharges = entries.reduce((s, e) => s + surchargeSum(e.expenseItems), 0);
            const totalExpenses = entries.reduce((s, e) => s + expenseItemsSum(e.expenseItems), 0);
            const total = totalRevenue + totalIncomes - totalExpenses - totalBonuses - totalAdvances - totalSurcharges;
            const cashNet = totalCash - totalBonuses - totalAdvances - totalExpenses;
            return (
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-300 flex flex-wrap gap-4 text-sm">
                <span className="text-slate-500">Итого по выбранным записям:</span>
                <span>Выручка: <strong className="text-green-700">{fmt(totalRevenue)}</strong></span>
                {totalIncomes > 0 && (
                  <span>Доп. доходы: <strong className="text-green-700">{fmt(totalIncomes)}</strong></span>
                )}
                {totalBonuses > 0 && (
                  <span>Бонусы: <strong className="text-red-600">{fmt(totalBonuses)}</strong></span>
                )}
                {totalAdvances > 0 && (
                  <span>Авансы: <strong className="text-red-600">{fmt(totalAdvances)}</strong></span>
                )}
                {totalSurcharges > 0 && (
                  <span>Доплаты: <strong className="text-red-600">{fmt(totalSurcharges)}</strong></span>
                )}
                {totalExpenses > 0 && (
                  <span>Расходы: <strong className="text-red-600">{fmt(totalExpenses)}</strong></span>
                )}
                <span className="border-l border-slate-300 pl-6">
                  Итого: <strong className={total >= 0 ? 'text-green-700' : 'text-red-700'}>{fmt(total)}</strong>
                </span>
                <span className="border-l border-slate-300 pl-6">
                  Наличными на руках: <strong className={cashNet >= 0 ? 'text-green-700' : 'text-red-700'}>{fmt(cashNet)}</strong>
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {tooltipEntry && (() => {
        const items = tooltipEntry.expenseItems.filter(i => !EXCLUDED_FROM_GENERIC_SUMS.has(i.category ?? ''));
        const advanceItems = tooltipEntry.expenseItems.filter(i => i.category === 'employeeAdvance');
        const surchargeItems = tooltipEntry.expenseItems.filter(i => i.category === 'employeeSurcharge');
        const hasContent = items.length > 0 || advanceItems.length > 0 || surchargeItems.length > 0 || tooltipEntry.generalComment;
        if (!hasContent) return null;
        return (
          <div
            style={{ position: 'fixed', left: tooltipPos.x + 16, top: tooltipPos.y + 8, zIndex: 9999 }}
            className="bg-white border border-slate-300 rounded p-3 text-xs max-w-sm pointer-events-none"
          >
            {items.length > 0 && (
              <div className="space-y-1.5">
                {items.map((item) => {
                  const type = monthlyFieldType(item.category);
                  const colorClass = type === 'income' ? 'text-green-700' : 'text-orange-700';
                  const label = ROW_LABEL[item.category ?? ''] ?? item.category ?? 'Без статьи';
                  return (
                    <div key={item.id} className="flex gap-2 items-baseline">
                      <span className={`font-semibold shrink-0 ${colorClass}`}>{fmt(item.amount)}</span>
                      <span className="text-slate-700">{label}</span>
                      {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {advanceItems.length > 0 && (
              <div className={`space-y-1.5 ${items.length > 0 ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {advanceItems.map((item) => {
                  const recipient = employees.find((e) => e.id === item.employeeId);
                  return (
                    <div key={item.id} className="flex gap-2 items-baseline">
                      <span className="font-semibold shrink-0 text-red-600">−{fmt(item.amount)}</span>
                      <span className="text-slate-700">Аванс</span>
                      <span className="text-slate-400">→ {recipient?.name ?? 'сотрудник не указан'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {surchargeItems.length > 0 && (
              <div className={`space-y-1.5 ${(items.length > 0 || advanceItems.length > 0) ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {surchargeItems.map((item) => {
                  const recipient = employees.find((e) => e.id === item.employeeId);
                  return (
                    <div key={item.id} className="flex gap-2 items-baseline">
                      <span className="font-semibold shrink-0 text-red-600">−{fmt(item.amount)}</span>
                      <span className="text-slate-700">Доплата</span>
                      <span className="text-slate-400">→ {recipient?.name ?? 'сотрудник не указан'}</span>
                      {item.comment && <span className="text-slate-400">— {item.comment}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {tooltipEntry.generalComment && (
              <div className={`text-slate-400 italic ${(items.length > 0 || advanceItems.length > 0 || surchargeItems.length > 0) ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {tooltipEntry.generalComment}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
