'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// Разбивает целую часть числа пробелами по разрядам и показывает запятую как
// разделитель дробной части: "1000000.5" -> "1 000 000,5". С pad=true дробная
// часть дополняется/обрезается до ровно двух знаков — используется при
// потере фокуса, чтобы не мешать вводу копеек во время набора.
function formatAmount(raw: string, pad: boolean): string {
  if (!raw) return '';
  const [intPart, decPart = ''] = raw.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (pad) return `${grouped},${(decPart + '00').slice(0, 2)}`;
  return raw.includes('.') ? `${grouped},${decPart}` : grouped;
}

// Оставляет только цифры и не больше одной точки (запятая приравнивается к
// точке), дробная часть — не больше двух знаков.
function sanitizeAmount(input: string): string {
  const cleaned = input.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  const decimals = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  return `${cleaned.slice(0, firstDot)}.${decimals}`;
}

function countDigitsBefore(text: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < caret && i < text.length; i++) {
    if (/[\d.,]/.test(text[i])) count++;
  }
  return count;
}

function caretFromDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d.,]/.test(formatted[i])) {
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

// Текстовое поле для денежных сумм: во время ввода расставляет пробелы между
// разрядами и запятую как разделитель дробной части, при потере фокуса
// дополняет дробную часть до двух знаков ("10777" -> "10 777,00"). Наружу
// (onChange) всегда отдаётся чистое число с точкой, без пробелов.
export function AmountInput({ value, onChange, className, ...rest }: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    if (caretRef.current !== null && ref.current) {
      ref.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  });

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      value={formatAmount(value, !focused)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const input = e.target;
        const caret = input.selectionStart ?? input.value.length;
        const digitsBefore = countDigitsBefore(input.value, caret);
        const raw = sanitizeAmount(input.value);
        caretRef.current = caretFromDigitCount(formatAmount(raw, false), digitsBefore);
        onChange(raw);
      }}
      {...rest}
    />
  );
}
