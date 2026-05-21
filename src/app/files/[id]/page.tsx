'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { StatusBadge } from '@/components/StatusBadge';
import { BANK_IMPORT_TARGET_FIELDS, monthlyFieldLabel } from '@/lib/monthly-report-fields';

interface Pharmacy {
  id: number;
  name: string;
}

interface Rule {
  id: number;
  name: string;
}

interface ReportValue {
  id: number;
  amount: string | number;
  status: string;
  distributionType: string;
  fieldKey: string;
  pharmacy: Pharmacy | null;
}

interface ImportedTransaction {
  id: number;
  transactionDate: string | null;
  amount: string | number;
  counterparty: string | null;
  binIin: string | null;
  paymentPurpose: string | null;
  matchedRule: Rule | null;
  detectedPharmacy: Pharmacy | null;
  targetFieldKey: string | null;
  detectedPharmacyId: number | null;
  distributionType: string | null;
  status: string;
  accountantComment: string | null;
  reportValues: ReportValue[];
}

interface Draft {
  fieldKey: string;
  pharmacyId: string;
  distributionType: string;
}

const DISTRIBUTIONS = [
  ['specific_pharmacy', 'Конкретная аптека'],
  ['detect_pharmacy_from_text', 'Определять по тексту'],
  ['split_equally', 'Разделить поровну'],
];

const STATUS_FILTERS = [
  ['all', 'Все'],
  ['needs_review', 'Нераспознанные'],
  ['pending', 'Ожидают'],
  ['approved', 'Подтверждены'],
  ['rejected', 'Отклонены'],
];

function fmtAmount(value: string | number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ru-RU');
}

export default function FileReviewPage() {
  const params = useParams();
  const uploadId = params.id as string;
  const [transactions, setTransactions] = useState<ImportedTransaction[]>([]);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const searchParams = new URLSearchParams();
    if (statusFilter !== 'all') searchParams.set('status', statusFilter);
    if (search.trim()) searchParams.set('search', search.trim());

    const [txRes, pharmacyRes] = await Promise.all([
      fetch(`/api/bank-imports/${uploadId}/transactions?${searchParams}`),
      fetch('/api/pharmacies'),
    ]);

    const txJson = await txRes.json();
    setTransactions(txJson.transactions ?? []);
    setCounts(txJson.counts ?? {});
    setPharmacies(await pharmacyRes.json());
    setLoading(false);
  }, [uploadId, statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  function draftFor(transaction: ImportedTransaction): Draft {
    return (
      drafts[transaction.id] ?? {
        fieldKey: transaction.targetFieldKey ?? '',
        pharmacyId: transaction.detectedPharmacyId ? String(transaction.detectedPharmacyId) : '',
        distributionType: transaction.distributionType || 'detect_pharmacy_from_text',
      }
    );
  }

  function updateDraft(id: number, patch: Partial<Draft>) {
    const transaction = transactions.find((item) => item.id === id);
    if (!transaction) return;
    setDrafts((current) => ({ ...current, [id]: { ...draftFor(transaction), ...patch } }));
  }

  async function saveTransaction(transaction: ImportedTransaction, status?: string) {
    const draft = draftFor(transaction);
    setSavingId(transaction.id);

    await fetch(`/api/imported-transactions/${transaction.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldKey: draft.fieldKey || null,
        pharmacyId:
          draft.distributionType === 'specific_pharmacy' || draft.distributionType === 'detect_pharmacy_from_text'
            ? draft.pharmacyId || null
            : null,
        distributionType: draft.distributionType,
        status,
      }),
    });

    setSavingId(null);
    await load();
  }

  async function approveAllPending() {
    const ready = transactions.filter((tx) => tx.status === 'pending');
    if (!ready.length || !confirm(`Подтвердить ${ready.length} распознанных транзакций?`)) return;

    for (const transaction of ready) {
      await saveTransaction(transaction, 'approved');
    }
  }

  const needsReviewCount = counts.needs_review ?? 0;
  const pendingCount = counts.pending ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <Link href="/files" className="btn-secondary text-xs">
          Назад к импортам
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Проверка банковских транзакций</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Подтвердите распознанные строки. После подтверждения суммы попадут в существующее закрытие месяца.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card p-4">
          <div className="text-xs text-gray-400">Нераспознанные</div>
          <div className="text-2xl font-bold text-amber-700">{needsReviewCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-400">Ожидают</div>
          <div className="text-2xl font-bold text-blue-700">{pendingCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end mb-4">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map(([key, label]) => (
            <button
              key={key}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                statusFilter === key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
              {key !== 'all' && counts[key] ? <span className="ml-1 opacity-80">{counts[key]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[220px]">
          <input
            className="input"
            placeholder="Поиск по назначению, контрагенту или ИИН/БИН"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {pendingCount > 0 && (
          <button className="btn-success text-xs" onClick={approveAllPending}>
            Подтвердить распознанные
          </button>
        )}
      </div>

      {!loading && (search.trim() || statusFilter !== 'all') && (
        <div className="mb-3 text-sm text-gray-500">
          Найдено: <strong className="text-gray-800">{transactions.length}</strong>
          {search.trim() && <span className="ml-1">по запросу «{search.trim()}»</span>}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : transactions.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">Транзакций не найдено</div>
      ) : (
        <div className="space-y-3">
          {transactions.map((transaction) => {
            const draft = draftFor(transaction);
            const requiresPharmacy =
              draft.distributionType === 'specific_pharmacy' || draft.distributionType === 'detect_pharmacy_from_text';
            const isSaving = savingId === transaction.id;

            return (
              <div
                key={transaction.id}
                className={`card p-4 ${transaction.status === 'needs_review' ? 'border-amber-300 bg-amber-50/40' : ''}`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-[120px_140px_1fr_260px] gap-4">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Дата</div>
                    <div className="text-sm font-medium">{fmtDate(transaction.transactionDate)}</div>
                    <div className="mt-3 text-xs text-gray-400 mb-1">Сумма</div>
                    <div className="text-sm font-semibold tabular-nums">{fmtAmount(transaction.amount)}</div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-400 mb-1">Статус</div>
                    <StatusBadge status={transaction.status} />
                    <div className="text-xs text-gray-400 mt-3 mb-1">Правило</div>
                    <div className="text-xs text-gray-600">{transaction.matchedRule?.name ?? '—'}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs text-gray-400 mb-1">Контрагент / ИИН-БИН</div>
                    <div className="text-sm text-gray-800 break-words">{transaction.counterparty || '—'}</div>
                    <div className="text-xs text-gray-500 mt-1">{transaction.binIin || '—'}</div>
                    <div className="text-xs text-gray-400 mt-3 mb-1">Назначение платежа</div>
                    <div className="text-sm text-gray-700 break-words">{transaction.paymentPurpose || '—'}</div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="label text-xs">Поле закрытия месяца</label>
                      <select
                        className="input text-xs py-1.5"
                        value={draft.fieldKey}
                        onChange={(e) => updateDraft(transaction.id, { fieldKey: e.target.value })}
                      >
                        <option value="">— выбрать —</option>
                        {BANK_IMPORT_TARGET_FIELDS.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="label text-xs">Тип распределения</label>
                      <select
                        className="input text-xs py-1.5"
                        value={draft.distributionType}
                        onChange={(e) => updateDraft(transaction.id, { distributionType: e.target.value })}
                      >
                        {DISTRIBUTIONS.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {requiresPharmacy && (
                      <div>
                        <label className="label text-xs">Аптека</label>
                        <select
                          className="input text-xs py-1.5"
                          value={draft.pharmacyId}
                          onChange={(e) => updateDraft(transaction.id, { pharmacyId: e.target.value })}
                        >
                          <option value="">— выбрать —</option>
                          {pharmacies.map((pharmacy) => (
                            <option key={pharmacy.id} value={pharmacy.id}>
                              {pharmacy.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex gap-2 items-center">
                  <button className="btn-success text-xs" disabled={isSaving} onClick={() => saveTransaction(transaction, 'approved')}>
                    {isSaving ? 'Сохранение...' : 'Подтвердить'}
                  </button>
                  <button className="btn-danger text-xs" disabled={isSaving} onClick={() => saveTransaction(transaction, 'rejected')}>
                    Отклонить
                  </button>

                  {transaction.reportValues.length > 0 && (
                    <div className="relative group ml-1">
                      <span className="text-xs text-gray-400 hover:text-gray-600 cursor-default underline decoration-dotted select-none">
                        как попадёт в отчёт?
                      </span>
                      <div className="absolute hidden group-hover:block bottom-full left-0 mb-2 z-30 bg-white border border-gray-200 shadow-xl rounded-lg p-3 min-w-[280px]">
                        <div className="text-xs font-medium text-gray-600 mb-2">При подтверждении попадёт в закрытие месяца:</div>
                        <div className="space-y-1.5">
                          {transaction.reportValues.map((value) => (
                            <div key={value.id} className="flex items-center justify-between gap-4">
                              <div className="text-xs text-gray-700">
                                <span className="font-medium">{value.pharmacy?.name ?? 'Общий итог'}</span>
                                <span className="text-gray-400 mx-1">→</span>
                                <span>{monthlyFieldLabel(value.fieldKey)}</span>
                              </div>
                              <span className="text-xs font-semibold tabular-nums text-gray-900 shrink-0">
                                {fmtAmount(value.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
