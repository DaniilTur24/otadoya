'use client';

import { useLayoutEffect, useRef } from 'react';

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

// Текстовое поле для денежных сумм: во время ввода расставляет пробелы между
// разрядами для читаемости, а наружу (onChange) всегда отдаёт чистое число
// без пробелов — на хранение и расчёты это никак не влияет.
export function AmountInput({ value, onChange, className, ...rest }: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

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
      value={formatAmount(value)}
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
  );
}
