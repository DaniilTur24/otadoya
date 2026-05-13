'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { StatusBadge, CategoryBadge } from '@/components/StatusBadge';

interface Pharmacy {
  id: number;
  name: string;
}

interface ExpenseEntry {
  id: number;
  operationDate: string;
  amount: number;
  counterparty: string | null;
  description: string;
  category: string;
  status: string;
  reviewerComment: string | null;
  isManual: boolean;
  pharmacy: Pharmacy | null;
}

interface FileRow {
  rowIndex: number;
  operationDate: string | null;
  amount: string;
  counterparty: string | null;
  description: string;
  autoCategory: 'rent' | 'expense' | null;
  alreadyAdded: boolean;
  expenseId: number | null;
  expenseStatus: string | null;
  expenseCategory: string | null;
}

function fmt(n: number | string) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num) || num === 0) return '—';
  return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU');
}

// ─── Вкладка «Автоматически найденные» ──────────────────────────────────────

function AutoDetectedTab({
  fileId,
  pharmacies,
}: {
  fileId: string;
  pharmacies: Pharmacy[];
}) {
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [commentMap, setCommentMap] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editPharmacy, setEditPharmacy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (statusFilter !== 'all') p.set('status', statusFilter);
    if (categoryFilter !== 'all') p.set('category', categoryFilter);
    const res = await fetch(`/api/files/${fileId}/expenses?${p}`);
    setExpenses(await res.json());
    setLoading(false);
  }, [fileId, statusFilter, categoryFilter]);

  useEffect(() => { load(); }, [load]);

  async function approve(id: number) {
    await fetch(`/api/expenses/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerComment: commentMap[id] || '' }),
    });
    load();
  }

  async function reject(id: number) {
    if (!confirm('Отклонить запись?')) return;
    await fetch(`/api/expenses/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerComment: commentMap[id] || '' }),
    });
    load();
  }

  async function saveEdit(id: number) {
    await fetch(`/api/expenses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: editCategory, pharmacyId: editPharmacy || null }),
    });
    setEditingId(null);
    load();
  }

  async function approveAll() {
    const pending = expenses.filter((e) => e.status === 'pending');
    if (!pending.length || !confirm(`Подтвердить все ${pending.length} записей?`)) return;
    await Promise.all(
      pending.map((e) =>
        fetch(`/api/expenses/${e.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )
    );
    load();
  }

  const pendingCount = expenses.filter((e) => e.status === 'pending').length;

  return (
    <div>
      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="flex gap-1">
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {s === 'all' ? 'Все' : s === 'pending' ? 'Ожидает' : s === 'approved' ? 'Подтверждено' : 'Отклонено'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {['all', 'rent', 'expense'].map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                categoryFilter === c
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {c === 'all' ? 'Все категории' : c === 'rent' ? 'Аренда' : 'Расходы'}
            </button>
          ))}
        </div>
        {pendingCount > 1 && (
          <button onClick={approveAll} className="btn-success text-xs ml-auto">
            Подтвердить все ({pendingCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : expenses.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 text-sm">Записей не найдено</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="th">Дата</th>
                  <th className="th text-right">Сумма</th>
                  <th className="th">Контрагент</th>
                  <th className="th">Описание</th>
                  <th className="th">Категория</th>
                  <th className="th">Аптека</th>
                  <th className="th">Статус</th>
                  <th className="th">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map((entry) => (
                  <>
                    <tr
                      key={entry.id}
                      className={`${editingId === entry.id ? 'bg-blue-50' : 'hover:bg-gray-50'} ${
                        entry.isManual ? 'border-l-2 border-l-purple-400' : ''
                      }`}
                    >
                      <td className="td">
                        {fmtDate(entry.operationDate)}
                        {entry.isManual && (
                          <span className="ml-1 text-xs text-purple-500" title="Добавлено вручную">✎</span>
                        )}
                      </td>
                      <td className="td text-right font-semibold">{fmt(entry.amount)}</td>
                      <td className="td text-gray-500 max-w-[140px] truncate" title={entry.counterparty || ''}>
                        {entry.counterparty || '—'}
                      </td>
                      <td className="td max-w-[200px]">
                        <span className="line-clamp-2 text-xs text-gray-600" title={entry.description}>
                          {entry.description}
                        </span>
                      </td>
                      <td className="td">
                        {editingId === entry.id ? (
                          <select className="input text-xs py-1" value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}>
                            <option value="rent">Аренда</option>
                            <option value="expense">Расход</option>
                          </select>
                        ) : (
                          <CategoryBadge category={entry.category} />
                        )}
                      </td>
                      <td className="td">
                        {editingId === entry.id ? (
                          <select className="input text-xs py-1" value={editPharmacy}
                            onChange={(e) => setEditPharmacy(e.target.value)}>
                            <option value="">—</option>
                            {pharmacies.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {entry.pharmacy?.name ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="td"><StatusBadge status={entry.status} /></td>
                      <td className="td">
                        {editingId === entry.id ? (
                          <div className="flex gap-1">
                            <button className="btn-success text-xs" onClick={() => saveEdit(entry.id)}>Сохранить</button>
                            <button className="btn-secondary text-xs" onClick={() => setEditingId(null)}>Отмена</button>
                          </div>
                        ) : (
                          <div className="flex gap-1 flex-wrap">
                            {entry.status === 'pending' && (
                              <>
                                <button className="btn-success text-xs" onClick={() => approve(entry.id)}>Принять</button>
                                <button className="btn-danger text-xs" onClick={() => reject(entry.id)}>Откл.</button>
                              </>
                            )}
                            <button className="btn-secondary text-xs"
                              onClick={() => {
                                setEditingId(entry.id);
                                setEditCategory(entry.category);
                                setEditPharmacy(String(entry.pharmacy?.id || ''));
                              }}>
                              Изм.
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {entry.status === 'pending' && editingId !== entry.id && (
                      <tr key={`${entry.id}-c`} className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 shrink-0">Комментарий:</span>
                            <input type="text" className="input flex-1 text-xs py-1" placeholder="Необязательно"
                              value={commentMap[entry.id] || ''}
                              onChange={(e) => setCommentMap((m) => ({ ...m, [entry.id]: e.target.value }))} />
                          </div>
                        </td>
                      </tr>
                    )}
                    {entry.status !== 'pending' && entry.reviewerComment && (
                      <tr key={`${entry.id}-note`} className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-1 text-xs text-gray-400">
                          Комментарий: {entry.reviewerComment}
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

// ─── Вкладка «Просмотр всего файла» ─────────────────────────────────────────

function BrowseAllTab({
  fileId,
  pharmacies,
  onRowAdded,
}: {
  fileId: string;
  pharmacies: Pharmacy[];
  onRowAdded: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState<FileRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<Record<number, boolean>>({});
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  // Для ручного выбора категории и аптеки перед добавлением
  const [rowCategory, setRowCategory] = useState<Record<number, string>>({});
  const [rowPharmacy, setRowPharmacy] = useState<Record<number, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Дебаунс поиска — 400мс
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Загружаем строки при изменении запроса
  useEffect(() => {
    if (!debouncedSearch && rows.length === 0) return; // не грузим пока нет запроса
    if (!debouncedSearch) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const p = new URLSearchParams({ search: debouncedSearch });
    fetch(`/api/files/${fileId}/rows?${p}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setRows(data.rows ?? []);
          setTotalRows(data.total ?? 0);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [debouncedSearch, fileId]);

  async function loadAll() {
    setLoading(true);
    const res = await fetch(`/api/files/${fileId}/rows`);
    const data = await res.json();
    setRows(data.rows ?? []);
    setTotalRows(data.total ?? 0);
    setLoading(false);
  }

  async function addRow(row: FileRow) {
    const category = rowCategory[row.rowIndex] || row.autoCategory || 'expense';
    const pharmacyId = rowPharmacy[row.rowIndex] || '';

    setAdding((m) => ({ ...m, [row.rowIndex]: true }));
    const res = await fetch(`/api/files/${fileId}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rowIndex: row.rowIndex,
        category,
        pharmacyId: pharmacyId || null,
        operationDate: row.operationDate,
        amount: row.amount,
        counterparty: row.counterparty,
        description: row.description,
      }),
    });

    if (res.ok) {
      setAddedIds((s) => new Set(s).add(row.rowIndex));
      // Обновляем флаг в текущем списке
      setRows((prev) =>
        prev.map((r) =>
          r.rowIndex === row.rowIndex
            ? { ...r, alreadyAdded: true, expenseCategory: category }
            : r
        )
      );
      onRowAdded();
    }
    setAdding((m) => ({ ...m, [row.rowIndex]: false }));
  }

  const isNew = (idx: number) => addedIds.has(idx);

  return (
    <div>
      {/* Поиск */}
      <div className="flex gap-3 mb-4 items-start">
        <div className="flex-1">
          <label className="label">Поиск по названию контрагента или тексту описания</label>
          <input
            type="text"
            className="input"
            placeholder="Например: ТОО «Арендатор», аренда офиса, коммунальные..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="mt-6">
          <button className="btn-secondary text-sm" onClick={loadAll} disabled={loading}>
            Показать все строки
          </button>
        </div>
      </div>

      {/* Подсказка */}
      {!debouncedSearch && rows.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-gray-500 text-sm mb-2">
            Введите поисковый запрос, чтобы найти строки, или нажмите «Показать все строки» для просмотра всего файла.
          </p>
          {totalRows > 0 && (
            <p className="text-xs text-gray-400">Всего строк в файле: {totalRows}</p>
          )}
        </div>
      )}

      {loading && (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка строк...</div>
      )}

      {!loading && rows.length === 0 && debouncedSearch && (
        <div className="card p-8 text-center text-gray-400 text-sm">
          По запросу «{debouncedSearch}» ничего не найдено
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="text-xs text-gray-400 mb-2">
            Показано {rows.length} из {totalRows} строк
            {debouncedSearch && ` (поиск: «${debouncedSearch}»)`}
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="th">Дата</th>
                    <th className="th text-right">Сумма</th>
                    <th className="th">Контрагент</th>
                    <th className="th">Описание</th>
                    <th className="th">Авто-категория</th>
                    <th className="th">Добавить как</th>
                    <th className="th">Аптека</th>
                    <th className="th">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => {
                    const alreadyAdded = row.alreadyAdded || isNew(row.rowIndex);
                    return (
                      <tr
                        key={row.rowIndex}
                        className={alreadyAdded ? 'bg-green-50' : 'hover:bg-gray-50'}
                      >
                        <td className="td">{fmtDate(row.operationDate)}</td>
                        <td className="td text-right font-semibold">{fmt(row.amount)}</td>
                        <td className="td max-w-[160px]">
                          <span className="text-xs text-gray-600 line-clamp-2" title={row.counterparty || ''}>
                            {row.counterparty || '—'}
                          </span>
                        </td>
                        <td className="td max-w-[240px]">
                          <span className="text-xs text-gray-600 line-clamp-3" title={row.description}>
                            {row.description || '—'}
                          </span>
                        </td>
                        <td className="td">
                          {row.autoCategory ? (
                            <CategoryBadge category={row.autoCategory} />
                          ) : (
                            <span className="text-xs text-gray-300 italic">не определена</span>
                          )}
                        </td>
                        <td className="td">
                          {!alreadyAdded && (
                            <select
                              className="input text-xs py-1 w-28"
                              value={rowCategory[row.rowIndex] ?? row.autoCategory ?? 'expense'}
                              onChange={(e) =>
                                setRowCategory((m) => ({ ...m, [row.rowIndex]: e.target.value }))
                              }
                            >
                              <option value="rent">Аренда</option>
                              <option value="expense">Расход</option>
                            </select>
                          )}
                          {alreadyAdded && row.expenseCategory && (
                            <CategoryBadge category={row.expenseCategory} />
                          )}
                        </td>
                        <td className="td">
                          {!alreadyAdded && (
                            <select
                              className="input text-xs py-1 w-32"
                              value={rowPharmacy[row.rowIndex] ?? ''}
                              onChange={(e) =>
                                setRowPharmacy((m) => ({ ...m, [row.rowIndex]: e.target.value }))
                              }
                            >
                              <option value="">— не привязывать —</option>
                              {pharmacies.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="td">
                          {alreadyAdded ? (
                            <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                              ✓ Добавлено
                              {row.expenseStatus && (
                                <span className="text-gray-400 font-normal">
                                  ({row.expenseStatus === 'approved' ? 'подтв.' :
                                    row.expenseStatus === 'rejected' ? 'откл.' : 'ожидает'})
                                </span>
                              )}
                            </span>
                          ) : (
                            <button
                              className="btn-primary text-xs"
                              disabled={adding[row.rowIndex]}
                              onClick={() => addRow(row)}
                            >
                              {adding[row.rowIndex] ? '...' : 'Добавить'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function FileExpensesPage() {
  const params = useParams();
  const router = useRouter();
  const fileId = params.id as string;

  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [activeTab, setActiveTab] = useState<'auto' | 'browse'>('auto');
  const [autoCount, setAutoCount] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then(setPharmacies);
    // Загружаем количество автоматически найденных записей
    fetch(`/api/files/${fileId}/expenses`)
      .then((r) => r.json())
      .then((data) => setAutoCount(Array.isArray(data) ? data.length : 0));
  }, [fileId]);

  function refreshAutoCount() {
    fetch(`/api/files/${fileId}/expenses`)
      .then((r) => r.json())
      .then((data) => setAutoCount(Array.isArray(data) ? data.length : 0));
  }

  return (
    <div>
      <button onClick={() => router.push('/files')} className="btn-secondary text-xs mb-4">
        ← К списку файлов
      </button>

      <h1 className="text-xl font-bold text-gray-900 mb-1">Расходы из файла</h1>
      <p className="text-gray-500 text-sm mb-5">
        Просматривайте автоматически найденные строки или вручную ищите дополнительные расходы в файле.
      </p>

      {/* Переключатель вкладок */}
      <div className="flex gap-0 mb-5 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('auto')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'auto'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Найдено автоматически
          {autoCount !== null && (
            <span className={`ml-2 inline-block px-1.5 py-0.5 rounded-full text-xs ${
              activeTab === 'auto' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {autoCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'browse'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Просмотр всего файла
          <span className="ml-1.5 text-xs text-gray-400">— ручной поиск</span>
        </button>
      </div>

      {activeTab === 'auto' ? (
        <AutoDetectedTab fileId={fileId} pharmacies={pharmacies} />
      ) : (
        <BrowseAllTab
          fileId={fileId}
          pharmacies={pharmacies}
          onRowAdded={refreshAutoCount}
        />
      )}
    </div>
  );
}
