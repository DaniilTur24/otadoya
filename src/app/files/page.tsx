'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface BankImport {
  id: number;
  originalName: string;
  month: number | null;
  year: number | null;
  uploadedAt: string;
  _count: {
    importedTransactions: number;
    importedReportValues: number;
  };
}

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function fmtDate(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FilesPage() {
  const router = useRouter();
  const now = new Date();
  const [imports, setImports] = useState<BankImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadImports = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/bank-imports');
    setImports(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadImports();
  }, [loadImports]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setMessage('');
    setError('');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('month', String(month));
    formData.append('year', String(year));

    const res = await fetch('/api/bank-imports', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      setMessage(
        `Импортировано строк: ${data.importedCount}. На проверку: ${data.needsReviewCount}.`
      );
      setSelectedFile(null);
      const input = document.getElementById('bankFileInput') as HTMLInputElement | null;
      if (input) input.value = '';
      await loadImports();
      router.push(`/files/${data.id}`);
    } else {
      setError(data.error || 'Не удалось импортировать файл');
    }

    setUploading(false);
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Удалить импорт «${name}» и все связанные транзакции?`)) return;
    setError('');
    const res = await fetch(`/api/bank-imports/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Не удалось удалить импорт');
      return;
    }
    loadImports();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold text-gray-900">Загрузка банковской выписки</h1>
        <Link href="/reports/monthly" className="btn-secondary text-xs">
          Закрытие месяца
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Загрузите Excel со списком банковских транзакций. Система применит правила, алиасы аптек и отправит строки на проверку.
      </p>

      <div className="card p-5 mb-6">
        <h2 className="font-semibold text-gray-800 mb-4">Новый импорт</h2>
        <form onSubmit={upload} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_140px] gap-3">
            <div>
              <label className="label">Excel-файл *</label>
              <input
                id="bankFileInput"
                type="file"
                accept=".xlsx"
                required
                className="input file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <label className="label">Месяц *</label>
              <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Год *</label>
              <input
                type="number"
                min="2000"
                max="2100"
                className="input"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="bg-sky-50 border border-sky-200 rounded-md p-3 text-xs text-sky-800">
            После подтверждения строки попадут в существующее закрытие месяца, например в «Расходы по арендной плате» или «Расходы на хознужды».
          </div>

          <button className="btn-primary" disabled={uploading || !selectedFile}>
            {uploading ? 'Импорт...' : 'Загрузить и разобрать'}
          </button>
        </form>

        {message && <div className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">{message}</div>}
        {error && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>}
      </div>

      <h2 className="font-semibold text-gray-800 mb-3">Загруженные банковские выписки</h2>
      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Загрузка...</div>
      ) : imports.length === 0 ? (
        <div className="card p-8 text-sm text-gray-400 text-center">Импортов пока нет</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="th">Файл</th>
                  <th className="th">Период</th>
                  <th className="th">Загружен</th>
                  <th className="th text-center">Транзакции</th>
                  <th className="th text-center">Значения</th>
                  <th className="th">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {imports.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="td font-medium">{item.originalName}</td>
                    <td className="td text-gray-500">
                      {item.month ? MONTHS[item.month - 1] : '—'} {item.year ?? ''}
                    </td>
                    <td className="td text-gray-500">{fmtDate(item.uploadedAt)}</td>
                    <td className="td text-center">{item._count.importedTransactions}</td>
                    <td className="td text-center">{item._count.importedReportValues}</td>
                    <td className="td">
                      <div className="flex gap-2">
                        <Link href={`/files/${item.id}`} className="btn-secondary text-xs">
                          Проверить
                        </Link>
                        <button className="btn-danger text-xs" onClick={() => remove(item.id, item.originalName)}>
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
