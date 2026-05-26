import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body: data,
    }),
  },
}));

import {
  getRequestRole,
  requireRole,
  requireAdmin,
  requireAdminOrBookkeeper,
} from '@/lib/api-auth';

function makeRequest(role?: string): Request {
  const headers: Record<string, string> = {};
  if (role !== undefined) headers['x-user-role'] = role;
  return new Request('http://localhost/', { headers });
}

// ─── getRequestRole ──────────────────────────────────────────────────────────

describe('getRequestRole', () => {
  it('returns "admin" for admin role header', () => {
    expect(getRequestRole(makeRequest('admin'))).toBe('admin');
  });

  it('returns "bookkeeper" for bookkeeper role header', () => {
    expect(getRequestRole(makeRequest('bookkeeper'))).toBe('bookkeeper');
  });

  it('returns null for unknown role', () => {
    expect(getRequestRole(makeRequest('superuser'))).toBeNull();
  });

  it('returns null when header is missing', () => {
    expect(getRequestRole(makeRequest())).toBeNull();
  });

  it('returns null for empty string role', () => {
    expect(getRequestRole(makeRequest(''))).toBeNull();
  });
});

// ─── requireRole ────────────────────────────────────────────────────────────

describe('requireRole', () => {
  it('returns null when role is in allowed list', () => {
    expect(requireRole(makeRequest('admin'), ['admin'])).toBeNull();
  });

  it('returns null when bookkeeper is in allowed list', () => {
    expect(requireRole(makeRequest('bookkeeper'), ['admin', 'bookkeeper'])).toBeNull();
  });

  it('returns 401 when no role header', () => {
    const res = requireRole(makeRequest(), ['admin']) as { status: number };
    expect(res.status).toBe(401);
  });

  it('returns 403 when role not in allowed list', () => {
    const res = requireRole(makeRequest('bookkeeper'), ['admin']) as { status: number };
    expect(res.status).toBe(403);
  });

  it('returns 403 for unknown role that is not in list', () => {
    const res = requireRole(makeRequest('guest'), ['admin', 'bookkeeper']) as { status: number };
    expect(res.status).toBe(401);
  });
});

// ─── requireAdmin ────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  it('allows admin', () => {
    expect(requireAdmin(makeRequest('admin'))).toBeNull();
  });

  it('blocks bookkeeper with 403', () => {
    const res = requireAdmin(makeRequest('bookkeeper')) as { status: number };
    expect(res.status).toBe(403);
  });

  it('blocks missing role with 401', () => {
    const res = requireAdmin(makeRequest()) as { status: number };
    expect(res.status).toBe(401);
  });
});

// ─── requireAdminOrBookkeeper ────────────────────────────────────────────────

describe('requireAdminOrBookkeeper', () => {
  it('allows admin', () => {
    expect(requireAdminOrBookkeeper(makeRequest('admin'))).toBeNull();
  });

  it('allows bookkeeper', () => {
    expect(requireAdminOrBookkeeper(makeRequest('bookkeeper'))).toBeNull();
  });

  it('blocks missing role with 401', () => {
    const res = requireAdminOrBookkeeper(makeRequest()) as { status: number };
    expect(res.status).toBe(401);
  });

  it('blocks unknown role with 401', () => {
    const res = requireAdminOrBookkeeper(makeRequest('viewer')) as { status: number };
    expect(res.status).toBe(401);
  });
});
