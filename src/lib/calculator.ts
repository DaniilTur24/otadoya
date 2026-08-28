// Безопасный вычислитель арифметических выражений для мини-калькулятора в AmountInput.
// Без eval/Function — ручной токенайзер + recursive-descent парсер: +, -, *, /, скобки, унарный минус.

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(expr: string): Token[] | null {
  const normalized = expr
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\s+/g, '');
  if (!normalized) return null;

  const tokens: Token[] = [];
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (/[\d.]/.test(ch)) {
      let j = i + 1;
      while (j < normalized.length && /[\d.]/.test(normalized[j])) j++;
      const numStr = normalized.slice(i, j);
      if ((numStr.match(/\./g) || []).length > 1) return null;
      const num = parseFloat(numStr);
      if (Number.isNaN(num)) return null;
      tokens.push({ type: 'num', value: num });
      i = j;
    } else if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
    } else {
      return null;
    }
  }
  return tokens;
}

function parse(tokens: Token[]): number | null {
  let pos = 0;

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = t.value === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) {
        pos++;
        const right = parseFactor();
        if (right === null) return null;
        if (t.value === '/') {
          if (right === 0) return null;
          left = left / right;
        } else {
          left = left * right;
        }
      } else break;
    }
    return left;
  }

  function parseFactor(): number | null {
    const t = tokens[pos];
    if (!t) return null;
    if (t.type === 'op' && t.value === '-') {
      pos++;
      const val = parseFactor();
      return val === null ? null : -val;
    }
    if (t.type === 'op' && t.value === '+') {
      pos++;
      return parseFactor();
    }
    if (t.type === 'num') {
      pos++;
      return t.value;
    }
    if (t.type === 'lparen') {
      pos++;
      const val = parseExpr();
      if (val === null) return null;
      const close = tokens[pos];
      if (!close || close.type !== 'rparen') return null;
      pos++;
      return val;
    }
    return null;
  }

  const result = parseExpr();
  if (result === null || pos !== tokens.length) return null;
  return result;
}

/** Считает арифметическое выражение (+ - * /, скобки, унарный минус). null — если выражение некорректно (в т.ч. деление на 0). */
export function evaluateExpression(expr: string): number | null {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  const result = parse(tokens);
  if (result === null || !Number.isFinite(result)) return null;
  return result;
}

/** Число -> "сырая" строка для AmountInput: целое без дробной части, иначе до 2 знаков без лишних нулей. */
export function formatCalculatorResult(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  const fixed = rounded.toFixed(2);
  return fixed.endsWith('0') ? fixed.slice(0, -1) : fixed;
}

/** Считает выражение и сразу отдаёт строку для поля суммы. Денежные поля не бывают отрицательными — отрицательный результат обрезается до 0. */
export function evaluateToAmountString(expr: string): string | null {
  const result = evaluateExpression(expr);
  if (result === null) return null;
  return formatCalculatorResult(Math.max(0, result));
}
