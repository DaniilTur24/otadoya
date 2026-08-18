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
    importedTransaction: { findUnique: vi.fn(), update: vi.fn() },
    pharmacy: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/bank-transaction-import', () => ({
  regenerateImportedReportValues: vi.fn().mockResolvedValue({ status: 'pending', detectedPharmacyId: null }),
}));

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/imported-transactions/[id]/route';

const findUniqueTransaction = prisma.importedTransaction.findUnique as unknown as ReturnType<typeof vi.fn>;
const countPharmacy = prisma.pharmacy.count as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/imported-transactions/1', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  findUniqueTransaction.mockReset().mockResolvedValue({ amount: '1000.00' });
  countPharmacy.mockReset().mockResolvedValue(2);
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ importedTransaction: { update: vi.fn() } })
  );
});

describe('PUT /api/imported-transactions/[id] — валидация split_custom', () => {
  it('отклоняет пустое распределение', async () => {
    const res = await PUT(
      makeRequest({ distributionType: 'split_custom', fieldKey: 'rentExpenses', customDistribution: [] }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/хотя бы по одной аптеке/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('отклоняет некорректную (отрицательную) сумму', async () => {
    const res = await PUT(
      makeRequest({
        distributionType: 'split_custom',
        fieldKey: 'rentExpenses',
        customDistribution: [{ pharmacyId: 1, amount: '-5' }],
      }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Некорректная сумма/);
  });

  it('отклоняет некорректный ID аптеки', async () => {
    const res = await PUT(
      makeRequest({
        distributionType: 'split_custom',
        fieldKey: 'rentExpenses',
        customDistribution: [{ pharmacyId: 0, amount: '1000' }],
      }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Некорректная аптека/);
  });

  it('отклоняет, если сумма разбивки не равна сумме транзакции', async () => {
    findUniqueTransaction.mockResolvedValue({ amount: '1000.00' });

    const res = await PUT(
      makeRequest({
        distributionType: 'split_custom',
        fieldKey: 'rentExpenses',
        customDistribution: [{ pharmacyId: 1, amount: '400' }, { pharmacyId: 2, amount: '500' }],
      }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/не равна сумме транзакции/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('отклоняет несуществующую аптеку в разбивке', async () => {
    findUniqueTransaction.mockResolvedValue({ amount: '1000.00' });
    countPharmacy.mockResolvedValue(1); // указано 2 разных id, реально существует только 1

    const res = await PUT(
      makeRequest({
        distributionType: 'split_custom',
        fieldKey: 'rentExpenses',
        customDistribution: [{ pharmacyId: 1, amount: '500' }, { pharmacyId: 999, amount: '500' }],
      }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/несуществующая аптека/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('принимает корректную разбивку, сумма совпадает с точностью до копейки', async () => {
    findUniqueTransaction.mockResolvedValue({ amount: '999.99' });
    countPharmacy.mockResolvedValue(2);

    const res = await PUT(
      makeRequest({
        distributionType: 'split_custom',
        fieldKey: 'rentExpenses',
        customDistribution: [{ pharmacyId: 1, amount: '333.33' }, { pharmacyId: 2, amount: '666.66' }],
      }),
      makeParams()
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalled();
  });

  it('не проверяет разбивку для других типов распределения', async () => {
    const res = await PUT(
      makeRequest({ distributionType: 'specific_pharmacy', fieldKey: 'rentExpenses', pharmacyId: 1 }),
      makeParams()
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(findUniqueTransaction).not.toHaveBeenCalled();
  });
});
