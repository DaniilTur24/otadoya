'use client';

import { useEffect, useState } from 'react';
import { DayPicker, DateRange } from 'react-day-picker';
import { ru } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { format, startOfDay, startOfWeek, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';

interface DateRangeFilterProps {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  onChange: (from: string, to: string) => void;
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function toDisplay(value: string): string {
  const date = parseDate(value);
  return date ? format(date, 'dd.MM.yyyy') : '';
}

// Совпадает с Tailwind-брейкпоинтом sm (640px) — ниже него календарь показывает
// один месяц вместо двух и раскрывается как фиксированная панель во весь экран.
function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    setIsCompact(query.matches);
    const listener = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return isCompact;
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  // Черновик выбора в календаре — применяется только по кнопке "Применить".
  // Попап закрывается ровно в двух случаях: "Применить" или крестик — ни клик по пресету,
  // ни клик по "Сбросить" внутри попапа, ни клик снаружи его не закрывают.
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined);
  const isCompact = useIsCompact();

  function openPopup() {
    setDraftRange(from || to ? { from: parseDate(from), to: parseDate(to) } : undefined);
    setOpen(true);
  }

  function handleApply() {
    onChange(draftRange?.from ? toKey(draftRange.from) : '', draftRange?.to ? toKey(draftRange.to) : '');
    setOpen(false);
  }

  const today = startOfDay(new Date());
  const label =
    from && to
      ? `${toDisplay(from)} – ${toDisplay(to)}`
      : from
      ? `с ${toDisplay(from)}`
      : to
      ? `по ${toDisplay(to)}`
      : 'Весь период';

  return (
    <div className="relative">
      <label className="label">Период</label>
      <button type="button" className="input text-left" onClick={openPopup}>
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-x-3 top-16 z-30 sm:absolute sm:inset-x-auto sm:z-20 sm:top-auto sm:mt-1 card p-3 shadow-lg max-h-[85vh] overflow-y-auto sm:w-max"
        >
          <div className="flex items-start justify-between mb-3 gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => setDraftRange({ from: today, to: today })}>
                Сегодня
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setDraftRange({ from: subDays(today, 1), to: subDays(today, 1) })}
              >
                Вчера
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setDraftRange({ from: startOfWeek(today, { weekStartsOn: 1 }), to: today })}
              >
                Эта неделя
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setDraftRange({ from: startOfMonth(today), to: today })}
              >
                Этот месяц
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  const lastMonth = subMonths(today, 1);
                  setDraftRange({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
                }}
              >
                Прошлый месяц
              </button>
              {(draftRange?.from || draftRange?.to) && (
                <button type="button" className="btn-warning text-xs" onClick={() => setDraftRange(undefined)}>
                  Сбросить
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Закрыть"
              className="text-slate-400 hover:text-slate-700 text-2xl sm:text-lg leading-none px-2 py-1 -mt-1 -mr-1"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="flex justify-center overflow-x-auto">
            <DayPicker
              mode="range"
              min={1}
              numberOfMonths={isCompact ? 1 : 2}
              locale={ru}
              weekStartsOn={1}
              selected={draftRange}
              onSelect={setDraftRange}
              defaultMonth={draftRange?.from ?? today}
            />
          </div>
          <div className="flex justify-end mt-2 pt-2 border-t border-slate-200">
            <button type="button" className="btn-primary text-sm w-full sm:w-auto" onClick={handleApply}>
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
