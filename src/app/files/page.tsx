'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Pharmacy {
  id: number;
  name: string;
}

interface UploadedFile {
  id: number;
  originalName: string;
  pharmacy: Pharmacy | null;
  createdAt: string;
  _count: { expenses: number };
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function FilesPage() {
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPharmacy, setSelectedPharmacy] = useState('');
  const [uploadResult, setUploadResult] = useState<{
    count: number;
    error: string | null;
  } | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/files');
    const data = await res.json();
    setFiles(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/pharmacies')
      .then((r) => r.json())
      .then(setPharmacies);
    loadFiles();
  }, [loadFiles]);

  async function deleteFile(id: number, name: string) {
    if (!confirm(`Удалить файл «${name}» и все найденные в нём расходы?`)) return;
    await fetch(`/api/files/${id}`, { method: 'DELETE' });
    loadFiles();
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    if (selectedPharmacy) formData.append('pharmacyId', selectedPharmacy);

    const res = await fetch('/api/files', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (res.ok) {
      setUploadResult({ count: data.extractedCount, error: data.parseError });
      setSelectedFile(null);
      // сбрасываем input
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadFiles();
    } else {
      setUploadResult({ count: 0, error: data.error });
    }
    setUploading(false);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Загрузка файлов с расходами</h1>
      <p className="text-gray-500 text-sm mb-6">
        Загрузите Excel-выгрузку из банка. Система автоматически найдёт строки с расходами и арендой.
      </p>

      {/* Форма загрузки */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold text-gray-800 mb-3">Загрузить новый файл</h2>
        <form onSubmit={handleUpload} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Excel-файл *</label>
              <input
                id="fileInput"
                type="file"
                accept=".xlsx,.xls,.csv"
                required
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="input file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700"
              />
            </div>
            <div>
              <label className="label">Привязать к аптеке</label>
              <select
                value={selectedPharmacy}
                onChange={(e) => setSelectedPharmacy(e.target.value)}
                className="input"
              >
                <option value="">— не привязывать —</option>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
            Система ищет строки, где в описании операции встречаются слова:{' '}
            <strong>расход, расходы, аренда, аренду, арендная плата</strong> (без учёта регистра).
          </div>

          <button type="submit" className="btn-primary" disabled={uploading || !selectedFile}>
            {uploading ? 'Загрузка и парсинг...' : 'Загрузить и обработать'}
          </button>
        </form>

        {uploadResult && (
          <div
            className={`mt-3 p-3 rounded-md text-sm ${
              uploadResult.error
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-green-50 text-green-800 border border-green-200'
            }`}
          >
            {uploadResult.error ? (
              <>Ошибка обработки файла: {uploadResult.error}</>
            ) : (
              <>
                Файл загружен. Найдено строк с расходами/арендой:{' '}
                <strong>{uploadResult.count}</strong>. Просмотрите и подтвердите их ниже.
              </>
            )}
          </div>
        )}
      </div>

      {/* Список загруженных файлов */}
      <h2 className="font-semibold text-gray-800 mb-3">Загруженные файлы</h2>
      {loading ? (
        <div className="text-gray-400 text-sm py-4 text-center">Загрузка...</div>
      ) : files.length === 0 ? (
        <div className="card p-8 text-center text-gray-400 text-sm">
          Файлов ещё нет
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="th">Файл</th>
                <th className="th">Аптека</th>
                <th className="th">Загружен</th>
                <th className="th text-center">Найдено строк</th>
                <th className="th">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {files.map((file) => (
                <tr key={file.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{file.originalName}</td>
                  <td className="td text-gray-500">
                    {file.pharmacy?.name ?? <span className="italic text-gray-300">не привязан</span>}
                  </td>
                  <td className="td text-gray-500">{fmtDate(file.createdAt)}</td>
                  <td className="td text-center">
                    <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">
                      {file._count.expenses}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      <Link href={`/files/${file.id}`} className="btn-secondary text-xs">
                        Просмотреть →
                      </Link>
                      <button
                        className="btn-danger text-xs"
                        onClick={() => deleteFile(file.id, file.originalName)}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
