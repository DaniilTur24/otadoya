'use client';

import { useState, useEffect, useCallback } from 'react';

interface Pharmacy { id: number; name: string }

interface ParsedPreview {
  pharmacyId:        number;
  year:              number;
  month:             number;
  fileName:          string;
  markupPercent:     number | null;
  stockRetail:       number | null;
  stockWholesale:    number | null;
  allRetailValues:   number[];
  allWholesaleValues:number[];
  confident:         boolean;
}

interface SavedReport {
  id:             number;
  pharmacyId:     number;
  year:           number;
  month:          number;
  markupPercent:  number | null;
  stockRetail:    number | null;
  stockWholesale: number | null;
  status:         string;
  sourceFile:     string | null;
  confident:      boolean;
  pharmacy:       Pharmacy;
}

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];

function fmtN(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function EditableNumber({
  label, value, onChange, hint,
}: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function PdfImportPage() {
  const now = new Date();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);

  // Шаг 1: выбор параметров
  const [pharmacyId, setPharmacyId] = useState('');
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [file,  setFile]  = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Шаг 2: предпросмотр и правка
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [editMarkup,    setEditMarkup]    = useState('');
  const [editRetail,    setEditRetail]    = useState('');
  const [editWholesale, setEditWholesale] = useState('');

  // Шаг 3: сохранение
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [existingReport, setExistingReport] = useState<SavedReport | null>(null);

  // Редактирование сохранённых отчётов
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMarkupRow, setEditMarkupRow] = useState('');
  const [editRetailRow, setEditRetailRow] = useState('');
  const [editWholesaleRow, setEditWholesaleRow] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const loadReports = useCallback(async () => {
    const res = await fetch('/api/reports/pdf-import');
    setSavedReports(await res.json());
  }, []);

  useEffect(() => {
    fetch('/api/pharmacies').then((r) => r.json()).then(setPharmacies);
    loadReports();
  }, [loadReports]);

  // Парсим PDF
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !pharmacyId) return;
    setUploading(true);
    setUploadError('');
    setSaveSuccess(false);

    const form = new FormData();
    form.append('file', file);
    form.append('pharmacyId', pharmacyId);
    form.append('year',  String(year));
    form.append('month', String(month));

    const res = await fetch('/api/reports/pdf-import', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) {
      setUploadError(data.error || 'Ошибка парсинга');
      setUploading(false);
      return;
    }

    setPreview(data as ParsedPreview);
    setEditMarkup(   data.markupPercent  != null ? String(data.markupPercent)  : '');
    setEditRetail(   data.stockRetail    != null ? String(data.stockRetail)    : '');
    setEditWholesale(data.stockWholesale != null ? String(data.stockWholesale) : '');
    const found = savedReports.find(
      (r) => r.pharmacyId === Number(pharmacyId) && r.year === year && r.month === month
    );
    setExistingReport(found ?? null);
    setUploading(false);
  }

  // Подтверждаем и сохраняем
  async function handleConfirm() {
    if (!preview) return;
    setSaving(true);

    const parseInput = (v: string) => {
      const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
      return isNaN(n) ? null : n;
    };

    await fetch('/api/reports/pdf-import/new', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pharmacyId:    preview.pharmacyId,
        year:          preview.year,
        month:         preview.month,
        markupPercent:  parseInput(editMarkup),
        stockRetail:    parseInput(editRetail),
        stockWholesale: parseInput(editWholesale),
        sourceFile:    preview.fileName,
        confident:     preview.confident,
      }),
    });

    setSaving(false);
    setSaveSuccess(true);
    setPreview(null);
    setFile(null);
    const fileInput = document.getElementById('pdfInput') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
    loadReports();
  }

  function cancelPreview() {
    setPreview(null);
    setUploadError('');
    setExistingReport(null);
  }

  async function deleteReport(id: number) {
    if (!confirm('Удалить импортированный отчёт?')) return;
    await fetch(`/api/reports/pdf-import/${id}`, { method: 'DELETE' });
    loadReports();
  }

  function startEdit(r: SavedReport) {
    setEditingId(r.id);
    setEditMarkupRow(r.markupPercent != null ? String(r.markupPercent) : '');
    setEditRetailRow(r.stockRetail != null ? String(r.stockRetail) : '');
    setEditWholesaleRow(r.stockWholesale != null ? String(r.stockWholesale) : '');
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleEditSave(r: SavedReport) {
    setEditSaving(true);
    const parseInput = (v: string) => {
      const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
      return isNaN(n) ? null : n;
    };
    await fetch(`/api/reports/pdf-import/${r.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pharmacyId:    r.pharmacyId,
        year:          r.year,
        month:         r.month,
        markupPercent:  parseInput(editMarkupRow),
        stockRetail:    parseInput(editRetailRow),
        stockWholesale: parseInput(editWholesaleRow),
        sourceFile:    r.sourceFile,
        confident:     r.confident,
      }),
    });
    setEditingId(null);
    setEditSaving(false);
    loadReports();
  }

  const selectedPharmacy = pharmacies.find((p) => p.id === Number(pharmacyId));

  return (
    <div className="max-w-screen-lg">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Импорт PDF-отчётов</h1>
      <p className="text-sm text-slate-500 mb-4">
        Загрузите ежемесячный сводный PDF-отчёт аптеки. Система автоматически извлечёт
        коэффициент, остатки товара и подставит их в закрытие месяца.
      </p>

      {/* ── Шаг 1: загрузка ──────────────────────────────────────────────── */}
      {!preview && (
        <div className="card p-4 mb-4">
          <h2 className="font-semibold text-slate-800 mb-3">Загрузить PDF-отчёт</h2>

          {saveSuccess && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
              Данные сохранены и подставлены в закрытие месяца.
            </div>
          )}

          {uploadError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {uploadError}
            </div>
          )}

          <form onSubmit={handleUpload} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3">
                <label className="label">Аптека *</label>
                <select
                  className="input"
                  value={pharmacyId}
                  onChange={(e) => setPharmacyId(e.target.value)}
                  required
                >
                  <option value="">— выберите аптеку —</option>
                  {pharmacies.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Месяц *</label>
                <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Год *</label>
                <input type="number" className="input" value={year} min={2020} max={2099}
                  onChange={(e) => setYear(Number(e.target.value))} />
              </div>
              <div className="sm:col-span-3">
                <label className="label">PDF-файл *</label>
                <input
                  id="pdfInput"
                  type="file"
                  accept=".pdf"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="input file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm file:bg-slate-100 file:text-slate-800"
                />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={uploading || !file || !pharmacyId}>
              {uploading ? 'Парсинг PDF...' : 'Загрузить и извлечь данные'}
            </button>
          </form>
        </div>
      )}

      {/* ── Шаг 2: предпросмотр и правка ──────────────────────────────────── */}
      {preview && (
        <div className={`card p-4 mb-4 ${!preview.confident ? 'border-amber-300 border' : 'border-slate-400 border'}`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-semibold text-slate-800">Проверьте извлечённые данные</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {selectedPharmacy?.name} · {MONTH_NAMES[preview.month - 1]} {preview.year}
              </p>
            </div>
            <button onClick={cancelPreview} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
          </div>

          {existingReport && (
            <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
              <strong>Внимание:</strong> для {selectedPharmacy?.name} за {MONTH_NAMES[preview.month - 1]} {preview.year} уже загружен отчёт
              {existingReport.sourceFile && (
                <span className="text-red-600"> ({existingReport.sourceFile})</span>
              )}
              . При сохранении старый отчёт будет заменён новым.
            </div>
          )}

          {!preview.confident && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-sm">
              Система не уверена в правильности некоторых значений — проверьте и при необходимости исправьте вручную.
            </div>
          )}

          {/* Все найденные значения для справки */}
          <div className="mb-4 bg-slate-50 border border-slate-300 rounded p-3 text-xs text-slate-500 space-y-1">
            <div>
              Все найденные «розничным ценам»:{' '}
              <strong className="text-slate-700">{preview.allRetailValues.map(fmtN).join(' → ')}</strong>
              <span className="ml-2 text-slate-700">(взято второе)</span>
            </div>
            <div>
              Все найденные «оптовым ценам»:{' '}
              <strong className="text-slate-700">{preview.allWholesaleValues.map(fmtN).join(' → ')}</strong>
              <span className="ml-2 text-slate-700">(взято второе)</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <EditableNumber
              label="Наценка от выручки (%)"
              value={editMarkup}
              onChange={setEditMarkup}
              hint={(() => {
                const n = parseFloat(editMarkup.replace(',', '.'));
                if (isNaN(n)) return '→ Коэффициент в закрытии месяца';
                return `→ Коэффициент: ${(Math.round((1 + n / 100) * 100) / 100).toFixed(2)}`;
              })()}
            />
            <EditableNumber
              label="Остаток по розн ценам"
              value={editRetail}
              onChange={setEditRetail}
              hint="На конец месяца"
            />
            <EditableNumber
              label="Остаток по опт ценам"
              value={editWholesale}
              onChange={setEditWholesale}
              hint="На конец месяца"
            />
          </div>

          <div className="flex gap-3">
            {existingReport ? (
              <button
                className="px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                onClick={handleConfirm}
                disabled={saving}
              >
                {saving ? 'Сохранение...' : 'Да, заменить старый отчёт'}
              </button>
            ) : (
              <button className="btn-primary" onClick={handleConfirm} disabled={saving}>
                {saving ? 'Сохранение...' : 'Подтвердить и сохранить'}
              </button>
            )}
            <button className="btn-secondary" onClick={cancelPreview}>Отмена</button>
          </div>
        </div>
      )}

      {/* ── Список сохранённых отчётов ─────────────────────────────────── */}
      <h2 className="font-semibold text-slate-800 mb-3">
        Загруженные отчёты
        {savedReports.length > 0 && (
          <span className="ml-2 text-xs font-normal text-slate-400">({savedReports.length})</span>
        )}
      </h2>

      {savedReports.length === 0 ? (
        <div className="card p-5 text-center text-slate-500 text-sm">Отчётов ещё нет</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="th">Аптека</th>
                <th className="th">Период</th>
                <th className="th text-right">Коэф.</th>
                <th className="th text-right">Остаток розн</th>
                <th className="th text-right">Остаток опт</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {savedReports.map((r) => {
                const isEditing = editingId === r.id;
                if (isEditing) {
                  return (
                    <tr key={r.id} className="bg-slate-100">
                      <td className="td font-medium">{r.pharmacy.name}</td>
                      <td className="td text-slate-500">{MONTH_NAMES[r.month - 1]} {r.year}</td>
                      <td className="td">
                        <input
                          type="text"
                          className="w-full text-right text-xs border border-slate-400 rounded px-1 py-0.5 bg-white"
                          value={editMarkupRow}
                          onChange={(e) => setEditMarkupRow(e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="td">
                        <input
                          type="text"
                          className="w-full text-right text-xs border border-slate-400 rounded px-1 py-0.5 bg-white"
                          value={editRetailRow}
                          onChange={(e) => setEditRetailRow(e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="td">
                        <input
                          type="text"
                          className="w-full text-right text-xs border border-slate-400 rounded px-1 py-0.5 bg-white"
                          value={editWholesaleRow}
                          onChange={(e) => setEditWholesaleRow(e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td className="td text-right whitespace-nowrap">
                        <button
                          className="text-slate-700 hover:text-slate-900 text-xs font-medium mr-2"
                          onClick={() => handleEditSave(r)}
                          disabled={editSaving}
                        >
                          {editSaving ? 'Сохр...' : 'Сохранить'}
                        </button>
                        <button
                          className="text-slate-400 hover:text-slate-600 text-xs"
                          onClick={cancelEdit}
                        >
                          Отмена
                        </button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td font-medium">{r.pharmacy.name}</td>
                    <td className="td text-slate-500">{MONTH_NAMES[r.month - 1]} {r.year}</td>
                    <td className="td text-right">{r.markupPercent != null ? fmtN(r.markupPercent) + '%' : '—'}</td>
                    <td className="td text-right">{fmtN(r.stockRetail)}</td>
                    <td className="td text-right">{fmtN(r.stockWholesale)}</td>
                    <td className="td text-right whitespace-nowrap">
                      <button
                        className="text-slate-400 hover:text-slate-700 text-xs mr-3"
                        onClick={() => startEdit(r)}
                      >
                        Изменить
                      </button>
                      <button
                        className="text-red-400 hover:text-red-600 text-xs"
                        onClick={() => deleteReport(r.id)}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
