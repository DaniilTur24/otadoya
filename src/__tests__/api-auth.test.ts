import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body: data,
    }),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  getRequestRole,
  requireRole,
  requireAdmin,
  requireAdminOrBookkeeper,
  requireAnyRole,
} from '@/lib/api-auth';

const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findUniqueUser.mockReset();
});

function makeRequest(role?: string, userId?: number): Request {
  const headers: Record<string, string> = {};
  if (role !== undefined) headers['x-user-role'] = role;
  if (userId !== undefined) headers['x-user-id'] = String(userId);
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
  it('returns null when role is in allowed list', async () => {
    expect(await requireRole(makeRequest('admin'), ['admin'])).toBeNull();
  });

  it('returns null when bookkeeper is in allowed list', async () => {
    expect(await requireRole(makeRequest('bookkeeper'), ['admin', 'bookkeeper'])).toBeNull();
  });

  it('returns 401 when no role header', async () => {
    const res = await requireRole(makeRequest(), ['admin']) as { status: number };
    expect(res.status).toBe(401);
  });

  it('returns 403 when role not in allowed list', async () => {
    const res = await requireRole(makeRequest('bookkeeper'), ['admin']) as { status: number };
    expect(res.status).toBe(403);
  });

  it('returns 403 for unknown role that is not in list', async () => {
    const res = await requireRole(makeRequest('guest'), ['admin', 'bookkeeper']) as { status: number };
    expect(res.status).toBe(401);
  });
});

// ─── requireAdmin ────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  it('allows admin', async () => {
    expect(await requireAdmin(makeRequest('admin'))).toBeNull();
  });

  it('blocks bookkeeper with 403', async () => {
    const res = await requireAdmin(makeRequest('bookkeeper')) as { status: number };
    expect(res.status).toBe(403);
  });

  it('blocks missing role with 401', async () => {
    const res = await requireAdmin(makeRequest()) as { status: number };
    expect(res.status).toBe(401);
  });
});

// ─── requireAdminOrBookkeeper ────────────────────────────────────────────────

describe('requireAdminOrBookkeeper', () => {
  it('allows admin', async () => {
    expect(await requireAdminOrBookkeeper(makeRequest('admin'))).toBeNull();
  });

  it('allows bookkeeper', async () => {
    expect(await requireAdminOrBookkeeper(makeRequest('bookkeeper'))).toBeNull();
  });

  it('blocks missing role with 401', async () => {
    const res = await requireAdminOrBookkeeper(makeRequest()) as { status: number };
    expect(res.status).toBe(401);
  });

  it('blocks unknown role with 401', async () => {
    const res = await requireAdminOrBookkeeper(makeRequest('viewer')) as { status: number };
    expect(res.status).toBe(401);
  });
});

// ─── requireRole — manager isActive check ────────────────────────────────────
// Токен живёт 7 дней и isActive проверялся только при логине; отключённый/уволенный
// заведующий сохранял бы доступ до истечения токена. Теперь проверяется на каждый запрос.

describe('requireRole — manager isActive', () => {
  it('allows an active manager', async () => {
    findUniqueUser.mockResolvedValue({ isActive: true });
    expect(await requireAnyRole(makeRequest('manager', 7))).toBeNull();
    expect(findUniqueUser).toHaveBeenCalledWith({ where: { id: 7 }, select: { isActive: true } });
  });

  it('blocks a disabled manager with 403, even though the role itself is allowed', async () => {
    findUniqueUser.mockResolvedValue({ isActive: false });
    const res = await requireAnyRole(makeRequest('manager', 7)) as { status: number };
    expect(res.status).toBe(403);
  });

  it('blocks a manager whose account no longer exists', async () => {
    findUniqueUser.mockResolvedValue(null);
    const res = await requireAnyRole(makeRequest('manager', 7)) as { status: number };
    expect(res.status).toBe(403);
  });

  it('blocks a manager token with no userId', async () => {
    const res = await requireAnyRole(makeRequest('manager')) as { status: number };
    expect(res.status).toBe(403);
    expect(findUniqueUser).not.toHaveBeenCalled();
  });

  it('does not touch the database for admin/bookkeeper', async () => {
    expect(await requireAdmin(makeRequest('admin'))).toBeNull();
    expect(findUniqueUser).not.toHaveBeenCalled();
  });
});
