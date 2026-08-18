'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '@/components/StatusBadge';

interface Pharmacy {
  id: number;
  name: string;
}

interface RevenueEntry {
  id: number;
  date: string;
  pharmacy: Pharmacy;
  cashRevenue: number;
  terminalRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  expenseComment: string | null;
  generalComment: string | null;
  employeeName: string;
  status: string;
  bookkeeperComment: string | null;
  createdAt: string;
}

interface EditState {
  cashRevenue: string;
  terminalRevenue: string;
  additionalExpenses: string;
  expenseComment: string;
  generalComment: string;
  bookkeeperComment: string;
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU');
}

export default function BookkeeperPage() {
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [commentMap, setCommentMap] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/revenue?status=${statusFilter}`);
    const data = await res.json();
    setEntries(data);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function approve(id: number) {
    await fetch(`/api/revenue/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookkeeperComment: commentMap[id] || '' }),
    });
    setCommentMap((m) => { const n = { ...m }; delete n[id]; return n; });
    load();
  }

  async function reject(id: number) {
    if (!confirm('Отклонить запись?')) return;
    await fetch(`/api/revenue/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookkeeperComment: commentMap[id] || '' }),
    });
    setCommentMap((m) => { const n = { ...m }; delete n[id]; return n; });
    load();
  }

  function startEdit(entry: RevenueEntry) {
    setEditingId(entry.id);
    setEditState({
      cashRevenue: String(entry.cashRevenue),
      terminalRevenue: String(entry.terminalRevenue),
      additionalExpenses: String(entry.additionalExpenses),
      expenseComment: entry.expenseComment || '',
      generalComment: entry.generalComment || '',
      bookkeeperComment: entry.bookkeeperComment || '',
    });
  }

  async function saveEdit(id: number) {
    if (!editState) return;
    setSavingEdit(true);
    await fetch(`/api/revenue/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editState),
    });
    setSavingEdit(false);
    setEditingId(null);
    setEditState(null);
    load();
  }

  const counts = {
    pending: entries.filter((e) => e.status === 'pending').length,
    approved: entries.filter((e) => e.status === 'approved').length,
    rejected: entries.filter((e) => e.status === 'rejected').length,
  };

  const statusButtons: { key: string; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'pending', label: `Ожидает проверки` },
    { key: 'approved', label: 'Подтверждено' },
    { key: 'rejected', label: 'Отклонено' },
  ];

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Проверка записей выручки</h1>
      <p className="text-slate-500 text-sm mb-4">
        Подтвердите, отклоните или отредактируйте записи от сотрудников аптек.
      </p>

      {/* Фильтр по статусу */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {statusButtons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-2.5 py-1 rounded text-sm font-medium border transition-colors ${
              statusFilter === key
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm py-5 text-center flex items-center justify-center gap-2">
          <span className="spinner" /> Загрузка...
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">
          Нет записей
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Дата</th>
                  <th className="th">Аптека</th>
                  <th className="th text-right">Наличные</th>
                  <th className="th text-right">Терминал</th>
                  <th className="th text-right">Выручка</th>
                  <th className="th text-right">Расходы</th>
                  <th className="th">Сотрудник</th>
                  <th className="th">Статус</th>
                  <th className="th">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <>
                    <tr key={entry.id} className={editingId === entry.id ? 'bg-slate-100' : 'hover:bg-slate-50'}>
                      <td className="td">{fmtDate(entry.date)}</td>
                      <td className="td font-medium">{entry.pharmacy.name}</td>

                      {editingId === entry.id && editState ? (
                        <>
                          <td className="td">
                            <input
                              type="number"
                              className="input w-28"
                              value={editState.cashRevenue}
                              onChange={(e) => setEditState({ ...editState, cashRevenue: e.target.value })}
                            />
                          </td>
                          <td className="td">
                            <input
                              type="number"
                              className="input w-28"
                              value={editState.terminalRevenue}
                              onChange={(e) => setEditState({ ...editState, terminalRevenue: e.target.value })}
                            />
                          </td>
                          <td className="td text-right font-medium">
                            {fmt(
                              (parseFloat(editState.cashRevenue) || 0) +
                              (parseFloat(editState.terminalRevenue) || 0)
                            )}
                          </td>
                          <td className="td">
                            <input
                              type="number"
                              className="input w-28"
                              value={editState.additionalExpenses}
                              onChange={(e) => setEditState({ ...editState, additionalExpenses: e.target.value })}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="td text-right">{fmt(entry.cashRevenue)}</td>
                          <td className="td text-right">{fmt(entry.terminalRevenue)}</td>
                          <td className="td text-right font-semibold">{fmt(entry.totalRevenue)}</td>
                          <td className="td text-right text-red-600">
                            {entry.additionalExpenses > 0 ? fmt(entry.additionalExpenses) : '—'}
                          </td>
                        </>
                      )}

                      <td className="td">
                        <div>{entry.employeeName}</div>
                        {entry.expenseComment && (
                          <div className="text-xs text-slate-400 mt-0.5">{entry.expenseComment}</div>
                        )}
                      </td>
                      <td className="td">
                        <StatusBadge status={entry.status} />
                      </td>
                      <td className="td">
                        {editingId === entry.id ? (
                          <div className="flex gap-1">
                            <button className="btn-success text-xs" disabled={savingEdit} onClick={() => saveEdit(entry.id)}>
                              {savingEdit && <span className="spinner" />}Сохранить
                            </button>
                            <button className="btn-secondary text-xs" onClick={() => setEditingId(null)}>
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1 flex-wrap">
                            {entry.status === 'pending' && (
                              <>
                                <button
                                  className="btn-success text-xs"
                                  onClick={() => approve(entry.id)}
                                >
                                  Принять
                                </button>
                                <button
                                  className="btn-danger text-xs"
                                  onClick={() => reject(entry.id)}
                                >
                                  Отклонить
                                </button>
                              </>
                            )}
                            <button
                              className="btn-secondary text-xs"
                              onClick={() => startEdit(entry)}
                            >
                              Изменить
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Расширенная строка: комментарий бухгалтера */}
                    {entry.status === 'pending' && editingId !== entry.id && (
                      <tr key={`${entry.id}-comment`} className="bg-slate-50">
                        <td colSpan={9} className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 shrink-0">Комментарий бухгалтера:</span>
                            <input
                              type="text"
                              className="input flex-1 text-xs py-1"
                              placeholder="Необязательно"
                              value={commentMap[entry.id] || ''}
                              onChange={(e) =>
                                setCommentMap((m) => ({ ...m, [entry.id]: e.target.value }))
                              }
                            />
                          </div>
                          {entry.generalComment && (
                            <div className="text-xs text-slate-400 mt-1">
                              Комментарий сотрудника: {entry.generalComment}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Строка с комментарием для подтверждённых/отклонённых */}
                    {entry.status !== 'pending' && (entry.bookkeeperComment || entry.generalComment) && (
                      <tr key={`${entry.id}-notes`} className="bg-slate-50">
                        <td colSpan={9} className="px-4 py-1.5 text-xs text-slate-500 space-y-0.5">
                          {entry.bookkeeperComment && (
                            <div>Комментарий бухгалтера: {entry.bookkeeperComment}</div>
                          )}
                          {entry.generalComment && (
                            <div>Комментарий сотрудника: {entry.generalComment}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
