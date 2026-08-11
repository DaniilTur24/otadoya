interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, RateLimitEntry>();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function nowMs() {
  return Date.now();
}

// Приложение раздаётся напрямую с *.up.railway.app, без Cloudflare или другого CDN перед ним —
// поэтому cf-connecting-ip/x-real-ip доверять нельзя вообще: их может свободно подставить сам
// клиент, никто перед Railway их не перезаписывает. x-forwarded-for — тоже клиентский заголовок,
// но ПОСЛЕДНЕЕ звено в нём добавляет собственный edge-прокси Railway на основе настоящего TCP-
// соединения, и клиент это значение подделать не может (он может только дописать себе фальшивые
// IP ПЕРЕД настоящим, что не меняет последнее звено). Если домен когда-нибудь окажется за другим
// прокси/CDN — эту логику нужно будет пересмотреть под его конкретную схему заголовков.
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = nowMs();
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true };
  }

  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
    };
  }

  return { allowed: true };
}

export function recordFailedLogin(key: string): void {
  const now = nowMs();
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  current.count += 1;
}

export function clearLoginRateLimit(key: string): void {
  attempts.delete(key);
}
