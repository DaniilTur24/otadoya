import { describe, it, expect } from 'vitest';
import { evaluateExpression, formatCalculatorResult, evaluateToAmountString } from '@/lib/calculator';

describe('evaluateExpression', () => {
  it('computes basic addition', () => {
    expect(evaluateExpression('2000+100')).toBe(2100);
  });

  it('computes basic subtraction, multiplication, division', () => {
    expect(evaluateExpression('10-4')).toBe(6);
    expect(evaluateExpression('6*7')).toBe(42);
    expect(evaluateExpression('20/4')).toBe(5);
  });

  it('respects operator precedence', () => {
    expect(evaluateExpression('2+3*4')).toBe(14);
    expect(evaluateExpression('2*3+4')).toBe(10);
    expect(evaluateExpression('10-2*3')).toBe(4);
  });

  it('supports parentheses', () => {
    expect(evaluateExpression('(2+3)*4')).toBe(20);
    expect(evaluateExpression('2*(3+4)')).toBe(14);
  });

  it('supports unary minus and plus', () => {
    expect(evaluateExpression('-5+10')).toBe(5);
    expect(evaluateExpression('+5+10')).toBe(15);
  });

  it('supports decimals and comma as decimal separator', () => {
    expect(evaluateExpression('10.5+0.5')).toBe(11);
    expect(evaluateExpression('10,5+0,5')).toBe(11);
  });

  it('supports × and ÷ calculator symbols', () => {
    expect(evaluateExpression('6×7')).toBe(42);
    expect(evaluateExpression('20÷4')).toBe(5);
  });

  it('ignores whitespace', () => {
    expect(evaluateExpression(' 2000 + 100 ')).toBe(2100);
  });

  it('returns null for division by zero', () => {
    expect(evaluateExpression('5/0')).toBeNull();
  });

  it('returns null for invalid expressions', () => {
    expect(evaluateExpression('')).toBeNull();
    expect(evaluateExpression('2++')).toBeNull();
    expect(evaluateExpression('2+')).toBeNull();
    expect(evaluateExpression('(2+3')).toBeNull();
    expect(evaluateExpression('2+3)')).toBeNull();
    expect(evaluateExpression('abc')).toBeNull();
    expect(evaluateExpression('2..5')).toBeNull();
  });

  it('merges whitespace-separated digits into one number, like a real calculator ignoring spaces', () => {
    // Пробелы полностью вырезаются перед разбором — это то же самое поведение,
    // которое делает "2000 + 100" валидным вводом (см. тест "ignores whitespace").
    expect(evaluateExpression('2 3')).toBe(23);
  });

  it('returns a plain number when the expression is already just a number', () => {
    expect(evaluateExpression('2000')).toBe(2000);
  });
});

describe('formatCalculatorResult', () => {
  it('formats whole numbers without a decimal point', () => {
    expect(formatCalculatorResult(2100)).toBe('2100');
    expect(formatCalculatorResult(0)).toBe('0');
  });

  it('formats one decimal digit without a trailing zero', () => {
    expect(formatCalculatorResult(2100.5)).toBe('2100.5');
  });

  it('formats two decimal digits as-is', () => {
    expect(formatCalculatorResult(2100.57)).toBe('2100.57');
  });

  it('rounds to 2 decimal places to avoid floating point artifacts', () => {
    expect(formatCalculatorResult(0.1 + 0.2)).toBe('0.3');
  });
});

describe('evaluateToAmountString', () => {
  it('evaluates and formats in one step', () => {
    expect(evaluateToAmountString('2000+100')).toBe('2100');
  });

  it('clamps negative results to 0 — money amounts are never negative', () => {
    expect(evaluateToAmountString('100-500')).toBe('0');
  });

  it('returns null for invalid expressions', () => {
    expect(evaluateToAmountString('2+')).toBeNull();
  });
});
