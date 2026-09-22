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
    cashMovement: { upsert: vi.fn(), deleteMany: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/cash-balance-query', () => ({
  loadCashBalance: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/cash-balance/route';

const upsert = prisma.cashMovement.upsert as unknown as ReturnType<typeof vi.fn>;
const deleteMany = prisma.cashMovement.deleteMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/cash-balance', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ id: 1 });
  deleteMany.mockResolvedValue({ count: 1 });
  findUniqueClosedMonth.mockResolvedValue(null);
});

describe('PUT /api/cash-balance', () => {
  // QA раунд 5, №7: остаток кассы копится нарастающим итогом день за днём и месяц за месяцем —
  // правка взноса в уже закрытом месяце задним числом сдвинула бы «Сальдо» во всех
  // последующих (в т.ч. открытых) месяцах, хотя закрытие обещает зафиксированные цифры.
  it('отклоняет изменение взноса в закрытом месяце с 423', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 3 });

    const res = (await PUT(makeRequest({ pharmacyId: 1, date: '2026-03-05', amount: 12345 }))) as unknown as {
      status: number;
      body: { error: string };
    };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Месяц закрыт/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('отклоняет обнуление взноса (удаление) в закрытом месяце тоже', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 3 });

    const res = (await PUT(makeRequest({ pharmacyId: 1, date: '2026-03-05', amount: 0 }))) as unknown as {
      status: number;
    };

    expect(res.status).toBe(423);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('проверяет закрытость именно того месяца, которому принадлежит дата взноса', async () => {
    findUniqueClosedMonth.mockResolvedValue(null);

    await PUT(makeRequest({ pharmacyId: 1, date: '2026-03-05', amount: 12345 }));

    expect(findUniqueClosedMonth).toHaveBeenCalledWith({ where: { year_month: { year: 2026, month: 3 } } });
  });

  it('отклоняет некорректные значения до проверки закрытого месяца', async () => {
    const res = (await PUT(makeRequest({ pharmacyId: 1, date: '2026-03-05', amount: -5 }))) as unknown as {
      status: number;
    };

    expect(res.status).toBe(400);
    expect(findUniqueClosedMonth).not.toHaveBeenCalled();
  });

  it('сохраняет взнос как обычно в открытом месяце', async () => {
    const res = (await PUT(makeRequest({ pharmacyId: 1, date: '2026-09-05', amount: 12345 }))) as unknown as {
      status: number;
      body: { ok: boolean; id: number };
    };

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(upsert).toHaveBeenCalled();
  });
});
