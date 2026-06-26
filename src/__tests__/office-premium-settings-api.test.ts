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
    officePremiumTier: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/office-premium-settings/route';

const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/office-premium-settings', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      officePremiumTier: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    })
  );
});

describe('PUT /api/office-premium-settings — проверка диапазонов', () => {
  it('отклоняет пересекающиеся диапазоны', async () => {
    const res = await PUT(
      makeRequest({
        tiers: [
          { fromAmount: 100, toAmount: 200, bonusAmount: 1000 },
          { fromAmount: 150, toAmount: 250, bonusAmount: 2000 },
        ],
      })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/пересекаются/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('отклоняет toAmount меньше или равный fromAmount', async () => {
    const res = await PUT(
      makeRequest({ tiers: [{ fromAmount: 200, toAmount: 100, bonusAmount: 1000 }] })
    ) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('отклоняет открытый диапазон (без toAmount) не на последнем месте', async () => {
    const res = await PUT(
      makeRequest({
        tiers: [
          { fromAmount: 100, toAmount: null, bonusAmount: 1000 },
          { fromAmount: 200, toAmount: 300, bonusAmount: 2000 },
        ],
      })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/последний/);
  });

  it('принимает корректные смежные диапазоны с открытым последним', async () => {
    const res = await PUT(
      makeRequest({
        tiers: [
          { fromAmount: 100, toAmount: 200, bonusAmount: 1000 },
          { fromAmount: 200, toAmount: null, bonusAmount: 2000 },
        ],
      })
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalled();
  });
});
