'use client';

import { useState } from 'react';
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

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  // Черновик выбора в календаре — применяется только по кнопке "Применить".
  // Попап закрывается ровно в двух случаях: "Применить" или крестик — ни клик по пресету,
  // ни клик по "Сбросить" внутри попапа, ни клик снаружи его не закрывают.
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined);

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
        <div className="absolute z-20 mt-1 card p-3 shadow-lg" style={{ width: 'max-content' }}>
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
              className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <DayPicker
            mode="range"
            min={1}
            numberOfMonths={2}
            locale={ru}
            weekStartsOn={1}
            selected={draftRange}
            onSelect={setDraftRange}
            defaultMonth={draftRange?.from ?? today}
          />
          <div className="flex justify-end mt-2 pt-2 border-t border-slate-200">
            <button type="button" className="btn-primary text-sm" onClick={handleApply}>
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
