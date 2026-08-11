import { describe, it, expect } from 'vitest';
import {
  getClientIp,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
} from '@/lib/rate-limit';

// Use unique per-test keys to avoid cross-test state leakage.
let keyCounter = 0;
function uniqueKey(): string {
  return `test-ip-${++keyCounter}`;
}

// ─── getClientIp ─────────────────────────────────────────────────────────────

describe('getClientIp', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers });
  }

  it('ignores cf-connecting-ip and x-real-ip — не за Cloudflare/прокси, клиент может их подделать', () => {
    expect(
      getClientIp(makeRequest({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))
    ).toBe('unknown');
  });

  it('uses the LAST x-forwarded-for entry — это то звено, которое добавляет сам Railway', () => {
    expect(
      getClientIp(makeRequest({ 'x-forwarded-for': '4.4.4.4, 5.5.5.5' }))
    ).toBe('5.5.5.5');
  });

  it('клиент не может подменить IP, дописав фальшивые адреса перед настоящим', () => {
    // Атакующий шлёт свой собственный x-forwarded-for — но Railway дописывает
    // РЕАЛЬНЫЙ IP последним звеном, поэтому подмена не проходит.
    expect(
      getClientIp(makeRequest({ 'x-forwarded-for': 'attacker-spoofed-1, attacker-spoofed-2, 9.9.9.9' }))
    ).toBe('9.9.9.9');
  });

  it('handles a single x-forwarded-for entry (no proxy hops)', () => {
    expect(getClientIp(makeRequest({ 'x-forwarded-for': '6.6.6.6' }))).toBe('6.6.6.6');
  });

  it('returns "unknown" when no IP headers present', () => {
    expect(getClientIp(makeRequest({}))).toBe('unknown');
  });
});

// ─── checkLoginRateLimit ─────────────────────────────────────────────────────

describe('checkLoginRateLimit', () => {
  it('allows first request', () => {
    const key = uniqueKey();
    expect(checkLoginRateLimit(key)).toEqual({ allowed: true });
  });

  it('allows requests below the limit', () => {
    const key = uniqueKey();
    for (let i = 0; i < 7; i++) recordFailedLogin(key);
    expect(checkLoginRateLimit(key)).toEqual({ allowed: true });
  });

  it('blocks after 8 failed attempts', () => {
    const key = uniqueKey();
    for (let i = 0; i < 8; i++) recordFailedLogin(key);
    const result = checkLoginRateLimit(key);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('retryAfterSeconds is at most 900 (15 minutes)', () => {
    const key = uniqueKey();
    for (let i = 0; i < 8; i++) recordFailedLogin(key);
    const result = checkLoginRateLimit(key);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(900);
  });
});

// ─── recordFailedLogin ───────────────────────────────────────────────────────

describe('recordFailedLogin', () => {
  it('increments the attempt count so the limit is hit', () => {
    const key = uniqueKey();
    // 8 failures should block
    for (let i = 0; i < 8; i++) recordFailedLogin(key);
    expect(checkLoginRateLimit(key).allowed).toBe(false);
  });

  it('initialises a fresh window if the key is new', () => {
    const key = uniqueKey();
    recordFailedLogin(key);
    // After 1 failure, 7 more are allowed
    expect(checkLoginRateLimit(key)).toEqual({ allowed: true });
  });
});

// ─── clearLoginRateLimit ─────────────────────────────────────────────────────

describe('clearLoginRateLimit', () => {
  it('allows requests again after clearing a blocked key', () => {
    const key = uniqueKey();
    for (let i = 0; i < 8; i++) recordFailedLogin(key);
    expect(checkLoginRateLimit(key).allowed).toBe(false);

    clearLoginRateLimit(key);
    expect(checkLoginRateLimit(key)).toEqual({ allowed: true });
  });

  it('is idempotent for a key that was never recorded', () => {
    const key = uniqueKey();
    expect(() => clearLoginRateLimit(key)).not.toThrow();
    expect(checkLoginRateLimit(key)).toEqual({ allowed: true });
  });
});
