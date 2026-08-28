'use client';

import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { evaluateExpression, evaluateToAmountString, formatCalculatorResult } from '@/lib/calculator';

// Разбивает целую часть числа пробелами по разрядам: "1000000" -> "1 000 000".
// Десятичная часть (после точки) не трогается.
function formatAmount(raw: string): string {
  if (!raw) return '';
  const [intPart, decPart] = raw.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

// Оставляет только цифры и не больше одной точки — то же самое, что раньше
// гарантировал браузерный type="number", но для текстового поля вручную.
function sanitizeAmount(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

function countDigitsBefore(text: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < caret && i < text.length; i++) {
    if (/[\d.]/.test(text[i])) count++;
  }
  return count;
}

function caretFromDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d.]/.test(formatted[i])) {
      count++;
      if (count === digitCount) return i + 1;
    }
  }
  return formatted.length;
}

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

const CALC_BUTTON_ROWS = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['C', '0', '.', '+'],
] as const;

// Мини-калькулятор, который открывается по кнопке рядом с полем суммы. Позиционируется
// через position: fixed от координат кнопки — чтобы не обрезался overflow-контейнерами
// (таблицы записей выручки используют overflow-x-auto/hidden для скролла и sticky-колонок).
function CalculatorPopup({
  anchorRef,
  initialValue,
  onApply,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement>;
  initialValue: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const [expr, setExpr] = useState(initialValue);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const exprInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
  }, [anchorRef]);

  // До того как coords посчитаны, компонент рендерит null — значит и поле ввода ещё не
  // существует в DOM. Фокусируем его только после того, как оно реально смонтировалось.
  // Курсор ставим в конец (не select all!) — иначе первый же введённый символ стёр бы
  // уже подставленное значение вместо того, чтобы дописаться к нему ("2000" + "+100").
  useEffect(() => {
    if (!coords) return;
    const input = exprInputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [coords]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleReposition() {
      onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [anchorRef, onClose]);

  const liveResult = evaluateExpression(expr);

  function applyExpr() {
    const result = evaluateToAmountString(expr);
    if (result === null) return;
    onApply(result);
    setExpr(result);
  }

  function pressKey(key: string) {
    if (key === 'C') {
      setExpr('');
      return;
    }
    setExpr((prev) => prev + key);
  }

  if (!coords) return null;

  return (
    <div
      ref={popupRef}
      style={{ position: 'fixed', top: coords.top, right: coords.right, zIndex: 9999 }}
      className="w-56 rounded border border-slate-300 bg-white p-2 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={exprInputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            applyExpr();
          }
        }}
        placeholder="0"
        className="input mb-1 text-right font-medium"
      />
      <div className="h-4 mb-1 px-1 text-right text-xs text-slate-400">
        {liveResult !== null ? `= ${formatCalculatorResult(liveResult)}` : ' '}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {CALC_BUTTON_ROWS.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => pressKey(key)}
            className={
              key === 'C'
                ? 'rounded border border-slate-300 bg-slate-50 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50'
                : /[0-9.]/.test(key)
                ? 'rounded border border-slate-300 bg-slate-50 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100'
                : 'rounded border border-slate-300 bg-slate-100 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200'
            }
          >
            {key}
          </button>
        ))}
      </div>
      <button type="button" onClick={applyExpr} className="btn-primary w-full mt-1 text-sm">
        =
      </button>
    </div>
  );
}

// Текстовое поле для денежных сумм: во время ввода расставляет пробелы между
// разрядами для читаемости, а наружу (onChange) всегда отдаёт чистое число
// без пробелов — на хранение и расчёты это никак не влияет.
//
// Рядом с полем — кнопка мини-калькулятора: открывает попап, предзаполненный текущим
// значением поля, где можно дописать выражение (например "+100") с клавиатуры или
// кнопками и получить результат обратно в поле.
export function AmountInput({ value, onChange, className, disabled, ...rest }: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const calcButtonRef = useRef<HTMLButtonElement>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  useLayoutEffect(() => {
    if (caretRef.current !== null && ref.current) {
      ref.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  });

  return (
    <div className="relative w-full">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={className}
        style={{ paddingRight: '1.75rem' }}
        value={formatAmount(value)}
        disabled={disabled}
        onChange={(e) => {
          const input = e.target;
          const caret = input.selectionStart ?? input.value.length;
          const digitsBefore = countDigitsBefore(input.value, caret);
          const raw = sanitizeAmount(input.value);
          caretRef.current = caretFromDigitCount(formatAmount(raw), digitsBefore);
          onChange(raw);
        }}
        {...rest}
      />
      {!disabled && (
        <button
          ref={calcButtonRef}
          type="button"
          tabIndex={-1}
          title="Калькулятор"
          onClick={() => setCalcOpen((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="11" x2="8" y2="11.01" />
            <line x1="12" y1="11" x2="12" y2="11.01" />
            <line x1="16" y1="11" x2="16" y2="11.01" />
            <line x1="8" y1="15" x2="8" y2="15.01" />
            <line x1="12" y1="15" x2="12" y2="15.01" />
            <line x1="16" y1="15" x2="16" y2="15.01" />
            <line x1="8" y1="19" x2="8" y2="19.01" />
            <line x1="12" y1="19" x2="12" y2="19.01" />
            <line x1="16" y1="19" x2="16" y2="19.01" />
          </svg>
        </button>
      )}
      {calcOpen && (
        <CalculatorPopup
          anchorRef={calcButtonRef}
          initialValue={value}
          onApply={onChange}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </div>
  );
}
