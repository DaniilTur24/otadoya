'use client';

import { useEffect, useRef } from 'react';

export interface ImpactMonth {
  year: number;
  month: number;
  shifts: number;
  attendance: number;
  isClosed: boolean;
}

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function monthDetail(m: ImpactMonth): string {
  const parts: string[] = [];
  if (m.shifts > 0) parts.push(`${m.shifts} ${plural(m.shifts, 'смена', 'смены', 'смен')}`);
  if (m.attendance > 0) {
    parts.push(`${m.attendance} ${plural(m.attendance, 'отметка', 'отметки', 'отметок')} в табеле`);
  }
  // Месяц без личных записей попадает в список только у заведующих/менеджеров: их премия
  // считается от выручки аптеки, а не от собственных смен.
  return parts.length > 0 ? parts.join(', ') : 'премия по аптеке';
}

interface Props {
  open: boolean;
  /** Заголовок — что именно меняется */
  title: string;
  /** Названия изменённых полей, показываются списком */
  changedFields: string[];
  /** Пояснение, к чему приведёт изменение */
  description: string;
  /** null вместе с loading=false — список месяцев неприменим, блок не показывается */
  months: ImpactMonth[] | null;
  loading: boolean;
  /** Дополнительный блок — например, список затронутых сотрудников */
  extra?: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Предупреждение перед изменением настройки, которая пересчитает зарплату задним числом.
 *
 * Показывается ТОЛЬКО когда затронутое поле реально изменилось — иначе диалог появлялся бы
 * на каждое сохранение (например, при правке имени) и его перестали бы читать. Список
 * конкретных месяцев с количеством записей нужен по той же причине: общая фраза «данные
 * пересчитаются» ни о чём не говорит, а «Август 2026 — 21 смена» заставляет остановиться.
 */
export function SalaryImpactDialog({
  open,
  title,
  changedFields,
  description,
  months,
  loading,
  extra,
  confirmLabel = 'Всё равно сохранить',
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const openMonths = months?.filter((m) => !m.isClosed) ?? [];
  const closedMonths = months?.filter((m) => m.isClosed) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="salary-impact-title"
        className="card w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 space-y-3 shadow-xl"
      >
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="text-xl leading-none mt-0.5">⚠️</span>
          <div>
            <h2 id="salary-impact-title" className="font-semibold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-600 mt-1">{description}</p>
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
          <div className="label mb-1.5">Что меняется</div>
          <ul className="text-sm text-slate-800 space-y-0.5">
            {changedFields.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 py-3 text-center flex items-center justify-center gap-2">
            <span className="spinner" /> Проверяем, какие месяцы затронет...
          </div>
        ) : openMonths.length > 0 ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-1.5">
              Будет пересчитана зарплата за {openMonths.length}{' '}
              {plural(openMonths.length, 'месяц', 'месяца', 'месяцев')}
            </div>
            <ul className="text-sm text-amber-900 space-y-0.5">
              {openMonths.map((m) => (
                <li key={`${m.year}-${m.month}`}>
                  • <span className="font-medium">{MONTH_NAMES[m.month - 1]} {m.year}</span>
                  {' '}— {monthDetail(m)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-800 mt-2">
              Включая месяцы, за которые зарплата уже могла быть выплачена. Итоговые суммы в
              карточке сотрудника и в отчёте изменятся задним числом.
            </p>
          </div>
        ) : months !== null ? (
          <div className="rounded border border-green-200 bg-green-50 p-2.5 text-sm text-green-800">
            Записей за прошлые периоды нет — изменение затронет только будущие расчёты.
          </div>
        ) : null}

        {closedMonths.length > 0 && (
          <div className="rounded border border-slate-200 bg-white p-2.5 text-xs text-slate-500">
            🔒 Закрытые месяцы не изменятся:{' '}
            {closedMonths.map((m) => `${MONTH_NAMES[m.month - 1]} ${m.year}`).join(', ')}
          </div>
        )}

        {extra}

        <div className="flex justify-end gap-2 pt-1">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="btn-warning" onClick={onConfirm} disabled={loading}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
