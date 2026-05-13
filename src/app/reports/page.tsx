'use client';

import { useState, useEffect, useCallback } from 'react';

interface Pharmacy {
  id: number;
  name: string;
}

interface PharmacyStats {
  id: number;
  name: string;
  cashRevenue: number;
  terminalRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  fileExpenses: number;
  fileRent: number;
  totalExpenses: number;
  netResult: number;
  entryCount: number;
}

interface Totals {
  cashRevenue: number;
  terminalRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  fileExpenses: number;
  fileRent: number;
  totalExpenses: number;
  netResult: number;
}

interface ExpenseItem {
  id: number;
  amount: number;
  comment: string | null;
}

interface RevenueDetail {
  id: number;
  date: string;
  pharmacy: Pharmacy;
  cashRevenue: number;
  terminalRevenue: number;
  totalRevenue: number;
  additionalExpenses: number;
  expenseItems: ExpenseItem[];
  employeeName: string;
  status: string;
  generalComment: string | null;
  bookkeeperComment: string | null;
}

interface ReportData {
  byPharmacy: PharmacyStats[];
  totals: Totals;
  unlinkedTotal: { fileExpenses: number; fileRent: number };
  revenueDetails: RevenueDetail[];
}

function fmt(n: number) {
  if (n === 0) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NetCell({ value }: { value: number }) {
  if (value > 0) return <span className="text-green-700 font-bold">{fmtNum(value)}</span>;
  if (value < 0) return <span className="text-red-600 font-bold">{fmtNum(value)}</span>;
  return <span className="text-gray-400">0.00</span>;
}

export default function ReportsPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.slice(0, 8) + '01';

  const [filters, setFilters] = useState({
    dateFrom: firstOfMonth,
    dateTo: today,
    pharmacyId: '',
    status: 'approved',
  });

  useEffect(() => {
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then(setPharmacies);
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.pharmacyId) params.set('pharmacyId', filters.pharmacyId);
    params.set('status', filters.status);
    const res = await fetch(`/api/reports?${params}`);
    const data = await res.json();
    setReport(data);
    setLoading(false);
  }, [filters]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const hasUnlinked =
    report && (report.unlinkedTotal.fileExpenses > 0 || report.unlinkedTotal.fileRent > 0);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Отчёты</h1>
      <p className="text-gray-500 text-sm mb-4">
        Сводный отчёт по аптекам. По умолчанию учитываются только подтверждённые записи.
      </p>

      {/* Фильтры */}
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="label">Дата с</label>
            <input
              type="date"
              className="input"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Дата по</label>
            <input
              type="date"
              className="input"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Аптека</label>
            <select
              className="input"
              value={filters.pharmacyId}
              onChange={(e) => setFilters((f) => ({ ...f, pharmacyId: e.target.value }))}
            >
              <option value="">Все аптеки</option>
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Статус записей</label>
            <select
              className="input"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="approved">Подтверждённые</option>
              <option value="pending">Ожидающие</option>
              <option value="all">Все</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка отчёта...</div>
      ) : report ? (
        <>
          {/* Сводная таблица по аптекам */}
          <div className="card overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="font-semibold text-gray-800 text-sm">Сводный отчёт по аптекам</h2>
            </div>
            {report.byPharmacy.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Нет данных за выбранный период
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="th">Аптека</th>
                      <th className="th text-right">Наличные</th>
                      <th className="th text-right">Терминал</th>
                      <th className="th text-right bg-blue-50">Выручка</th>
                      <th className="th text-right">Расх. (форма)</th>
                      <th className="th text-right">Расход (файл)</th>
                      <th className="th text-right">Аренда (файл)</th>
                      <th className="th text-right bg-gray-100">Итог</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.byPharmacy.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="td font-medium">{p.name}</td>
                        <td className="td text-right">{fmt(p.cashRevenue)}</td>
                        <td className="td text-right">{fmt(p.terminalRevenue)}</td>
                        <td className="td text-right font-semibold bg-blue-50">
                          {fmtNum(p.totalRevenue)}
                        </td>
                        <td className="td text-right text-red-600">{fmt(p.additionalExpenses)}</td>
                        <td className="td text-right text-red-600">{fmt(p.fileExpenses)}</td>
                        <td className="td text-right text-red-600">{fmt(p.fileRent)}</td>
                        <td className="td text-right bg-gray-50">
                          <NetCell value={p.netResult} />
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* Итоговая строка */}
                  <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                    <tr>
                      <td className="td font-bold">Итого</td>
                      <td className="td text-right font-bold">{fmtNum(report.totals.cashRevenue)}</td>
                      <td className="td text-right font-bold">{fmtNum(report.totals.terminalRevenue)}</td>
                      <td className="td text-right font-bold bg-blue-100">
                        {fmtNum(report.totals.totalRevenue)}
                      </td>
                      <td className="td text-right font-bold text-red-700">
                        {fmtNum(report.totals.additionalExpenses)}
                      </td>
                      <td className="td text-right font-bold text-red-700">
                        {fmtNum(report.totals.fileExpenses)}
                      </td>
                      <td className="td text-right font-bold text-red-700">
                        {fmtNum(report.totals.fileRent)}
                      </td>
                      <td className="td text-right bg-gray-200">
                        <NetCell value={report.totals.netResult} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Предупреждение о непривязанных расходах */}
          {hasUnlinked && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
              Внимание: есть расходы из файлов, не привязанные к аптеке (расходы:{' '}
              <strong>{fmtNum(report.unlinkedTotal.fileExpenses)}</strong>, аренда:{' '}
              <strong>{fmtNum(report.unlinkedTotal.fileRent)}</strong>). Привяжите их к аптекам
              на странице файлов для корректного отчёта.
            </div>
          )}

          {/* KPI-карточки */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">Общая выручка</div>
              <div className="text-lg font-bold text-blue-700">
                {fmtNum(report.totals.totalRevenue)}              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">Всего расходов</div>
              <div className="text-lg font-bold text-red-600">
                {fmtNum(
                  report.totals.additionalExpenses +
                    report.totals.fileExpenses +
                    report.totals.fileRent
                )}{' '}
                             </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">Аренда (из файлов)</div>
              <div className="text-lg font-bold text-purple-700">
                {fmtNum(report.totals.fileRent)}              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-500 mb-1">Чистый итог</div>
              <div className={`text-lg font-bold ${report.totals.netResult >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {fmtNum(report.totals.netResult)}              </div>
            </div>
          </div>

          {/* Детальные записи (разворачиваемые) */}
          <div className="card overflow-hidden">
            <button
              className="w-full px-4 py-3 text-left flex items-center justify-between bg-gray-50 border-b border-gray-200 hover:bg-gray-100"
              onClick={() => setShowDetails((v) => !v)}
            >
              <span className="font-semibold text-gray-800 text-sm">
                Детальные записи ({report.revenueDetails.length})
              </span>
              <span className="text-gray-400">{showDetails ? '▲' : '▼'}</span>
            </button>

            {showDetails && (
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
                      <th className="th">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.revenueDetails.map((e) => (
                      <>
                        <tr key={e.id} className="hover:bg-gray-50">
                          <td className="td">
                            {new Date(e.date).toLocaleDateString('ru-RU')}
                          </td>
                          <td className="td">{e.pharmacy.name}</td>
                          <td className="td text-right">{fmtNum(e.cashRevenue)}</td>
                          <td className="td text-right">{fmtNum(e.terminalRevenue)}</td>
                          <td className="td text-right font-semibold">{fmtNum(e.totalRevenue)}</td>
                          <td className="td text-right text-red-600">
                            {e.additionalExpenses > 0 ? fmtNum(e.additionalExpenses) : '—'}
                          </td>
                          <td className="td">{e.employeeName}</td>
                          <td className="td">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              e.status === 'approved' ? 'bg-green-100 text-green-800' :
                              e.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {e.status === 'approved' ? 'Подтверждено' :
                               e.status === 'rejected' ? 'Отклонено' : 'Ожидает'}
                            </span>
                          </td>
                        </tr>
                        {/* Детализация расходов по строкам */}
                        {e.expenseItems.length > 0 && (
                          <tr key={`${e.id}-items`} className="bg-orange-50">
                            <td colSpan={8} className="px-4 py-2">
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                <span className="text-xs font-medium text-orange-700 shrink-0">
                                  Расходы:
                                </span>
                                {e.expenseItems.map((item) => (
                                  <span key={item.id} className="text-xs text-orange-800">
                                    <strong>{fmtNum(item.amount)}</strong>
                                    {item.comment && (
                                      <span className="text-orange-600"> — {item.comment}</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
