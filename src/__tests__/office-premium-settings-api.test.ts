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
    officePremiumTier: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/office-premium-settings/route';

const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/office-premium-settings', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
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

  // Regression: findOfficeTierBonus() при выручке, не попавшей ни в один диапазон, молча
  // возвращает премию 0 ₸ — без ошибки, без пометки. Разрыв между диапазонами и открытый
  // сверху "хвост" таблицы — оба создают такую невидимую дыру. Найдено в QA-аудите (round 2, №7).
  it('отклоняет разрыв между диапазонами', async () => {
    const res = await PUT(
      makeRequest({
        tiers: [
          { fromAmount: 0, toAmount: 1000000, bonusAmount: 5000 },
          { fromAmount: 2000000, toAmount: null, bonusAmount: 10000 },
        ],
      })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/разрыв/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('отклоняет таблицу, где последний диапазон закрыт сверху', async () => {
    const res = await PUT(
      makeRequest({
        tiers: [
          { fromAmount: 0, toAmount: 1000000, bonusAmount: 5000 },
          { fromAmount: 1000000, toAmount: 2000000, bonusAmount: 10000 },
        ],
      })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/без верхней границы/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('принимает единственный диапазон без верхней границы', async () => {
    const res = await PUT(
      makeRequest({ tiers: [{ fromAmount: 0, toAmount: null, bonusAmount: 5000 }] })
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });

  it('принимает пустую таблицу (премия офиса отключена)', async () => {
    const res = await PUT(makeRequest({ tiers: [] })) as unknown as { status: number };

    expect(res.status).toBe(200);
  });
});
