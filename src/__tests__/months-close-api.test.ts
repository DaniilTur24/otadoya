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
    closedMonth: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    dailyRevenueEntry: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { DELETE } from '@/app/api/months/close/route';

const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/months/close', {
    method: 'DELETE',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  transaction.mockReset().mockResolvedValue([{}, { count: 0 }]);
});

describe('DELETE /api/months/close — повторное открытие месяца', () => {
  it('удаляет ClosedMonth и массово возвращает excludedFromReport записям этого месяца', async () => {
    const res = await DELETE(makeRequest({ year: 2026, month: 6 })) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    const ops = transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });

  it('требует year и month', async () => {
    const res = await DELETE(makeRequest({})) as unknown as { status: number };

    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
});
