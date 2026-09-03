import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

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
    closedMonth: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    dailyRevenueEntry: { updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { GET, DELETE } from '@/app/api/months/close/route';

const deleteManyClosedMonth = prisma.closedMonth.deleteMany as unknown as ReturnType<typeof vi.fn>;
const updateManyRevenueEntry = prisma.dailyRevenueEntry.updateMany as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;
const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown, method = 'DELETE', role = 'admin'): NextRequest {
  return new Request('http://localhost/api/months/close', {
    method,
    headers: { 'x-user-role': role, 'x-user-id': '5', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeGetRequest(year: number, month: number, role: string, userId?: number): NextRequest {
  const headers: Record<string, string> = { 'x-user-role': role };
  if (userId !== undefined) headers['x-user-id'] = String(userId);
  return new Request(`http://localhost/api/months/close?year=${year}&month=${month}`, { headers }) as unknown as NextRequest;
}

beforeEach(() => {
  deleteManyClosedMonth.mockReset().mockResolvedValue({ count: 1 });
  updateManyRevenueEntry.mockReset().mockResolvedValue({ count: 0 });
  transaction.mockReset().mockResolvedValue([{}, { count: 0 }]);
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  findUniqueUser.mockReset().mockResolvedValue({ isActive: true });
});

describe('GET /api/months/close — статус доступен и менеджеру', () => {
  it('заведующий получает статус месяца, а не 403', async () => {
    findUniqueClosedMonth.mockResolvedValue(null);

    const res = await GET(makeGetRequest(2026, 6, 'manager', 5)) as unknown as { status: number; body: { isClosed: boolean } };

    expect(res.status).toBe(200);
    expect(res.body.isClosed).toBe(false);
  });

  it('заведующий видит isClosed: true для закрытого месяца', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, closedAt: new Date('2026-07-01') });

    const res = await GET(makeGetRequest(2026, 6, 'manager', 5)) as unknown as { status: number; body: { isClosed: boolean } };

    expect(res.status).toBe(200);
    expect(res.body.isClosed).toBe(true);
  });

  it('без роли — 401', async () => {
    const res = await GET(new Request('http://localhost/api/months/close?year=2026&month=6') as unknown as NextRequest) as unknown as { status: number };
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/months/close — повторное открытие месяца', () => {
  it('удаляет только запись ClosedMonth', async () => {
    const res = await DELETE(makeRequest({ year: 2026, month: 6 })) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteManyClosedMonth).toHaveBeenCalledWith({ where: { year: 2026, month: 6 } });
  });

  // Regression: раньше открытие месяца обратно массово сбрасывало excludedFromReport
  // всем записям этого месяца — механизм остался от старого поведения (запись в закрытый
  // месяц раньше не отклонялась, а тихо помечалась excludedFromReport вместо 423). Сейчас
  // этот флаг выставляет только бухгалтер вручную как осознанное решение не учитывать
  // конкретную запись — открытие месяца обратно не должно его стирать.
  it('НЕ трогает excludedFromReport — это ручное решение бухгалтера, а не автопометка', async () => {
    await DELETE(makeRequest({ year: 2026, month: 6 }));

    expect(updateManyRevenueEntry).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('требует year и month', async () => {
    const res = await DELETE(makeRequest({})) as unknown as { status: number };

    expect(res.status).toBe(400);
    expect(deleteManyClosedMonth).not.toHaveBeenCalled();
  });
});
