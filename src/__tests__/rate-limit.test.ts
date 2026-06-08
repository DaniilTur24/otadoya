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

  it('prefers cf-connecting-ip', () => {
    expect(
      getClientIp(makeRequest({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))
    ).toBe('1.1.1.1');
  });

  it('falls back to x-real-ip when cf-connecting-ip absent', () => {
    expect(getClientIp(makeRequest({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('falls back to first x-forwarded-for entry', () => {
    expect(
      getClientIp(makeRequest({ 'x-forwarded-for': '4.4.4.4, 5.5.5.5' }))
    ).toBe('4.4.4.4');
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
