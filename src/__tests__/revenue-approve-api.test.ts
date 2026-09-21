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
    dailyRevenueEntry: { findUnique: vi.fn(), update: vi.fn() },
    extractedExpenseEntry: { findUnique: vi.fn(), update: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { POST as approveRevenue } from '@/app/api/revenue/[id]/approve/route';
import { POST as approveExpense } from '@/app/api/expenses/[id]/approve/route';
import { POST as rejectExpense } from '@/app/api/expenses/[id]/reject/route';
import { PUT as putExpense } from '@/app/api/expenses/[id]/route';

type Mock = ReturnType<typeof vi.fn>;
const findUniqueEntry = prisma.dailyRevenueEntry.findUnique as unknown as Mock;
const updateEntry = prisma.dailyRevenueEntry.update as unknown as Mock;
const findUniqueExpense = prisma.extractedExpenseEntry.findUnique as unknown as Mock;
const updateExpense = prisma.extractedExpenseEntry.update as unknown as Mock;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as Mock;

function makeRequest(url: string, role = 'admin', body: unknown = {}): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'x-user-role': role, 'x-user-id': '3', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
const makeParams = (id = 1) => ({ params: Promise.resolve({ id: String(id) }) });

beforeEach(() => {
  findUniqueEntry.mockReset().mockResolvedValue({ date: new Date('2026-09-08') });
  updateEntry.mockReset().mockResolvedValue({ id: 1, status: 'approved' });
  findUniqueExpense.mockReset().mockResolvedValue({ operationDate: new Date('2026-09-08') });
  updateExpense.mockReset().mockResolvedValue({ id: 1, status: 'approved', amount: '100' });
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
});

// QA раунд 4, №6: подтверждение «внутри» закрытого месяца никогда не попадёт в замороженный
// снимок, но статус при этом станет зелёным — бухгалтер решит, что всё учтено.
describe('POST /api/revenue/[id]/approve — закрытый месяц', () => {
  it('отвечает 423 и не меняет статус, если месяц записи закрыт', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 9 });

    const res = await approveRevenue(makeRequest('http://localhost/api/revenue/1/approve', 'bookkeeper'), makeParams(1)) as unknown as {
      status: number; body: { error: string };
    };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Месяц закрыт/);
    expect(updateEntry).not.toHaveBeenCalled();
    // проверялся именно месяц записи, а не «сегодняшний»
    expect(findUniqueClosedMonth).toHaveBeenCalledWith({ where: { year_month: { year: 2026, month: 9 } } });
  });

  it('подтверждает как обычно в открытом месяце и пишет approvedAt/approvedById', async () => {
    const res = await approveRevenue(makeRequest('http://localhost/api/revenue/1/approve', 'bookkeeper', { bookkeeperComment: 'ок' }), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    const data = updateEntry.mock.calls[updateEntry.mock.calls.length - 1][0].data;
    expect(data.status).toBe('approved');
    expect(data.approvedById).toBe(3);
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(data.bookkeeperComment).toBe('ок');
  });

  it('404, если записи нет (раньше это был необработанный P2025 → 500)', async () => {
    findUniqueEntry.mockResolvedValue(null);

    const res = await approveRevenue(makeRequest('http://localhost/api/revenue/999/approve'), makeParams(999)) as unknown as { status: number };

    expect(res.status).toBe(404);
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('заведующей подтверждение недоступно (403)', async () => {
    const res = await approveRevenue(makeRequest('http://localhost/api/revenue/1/approve', 'manager'), makeParams(1)) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
});

describe('POST /api/expenses/[id]/approve|reject — закрытый месяц', () => {
  it.each([
    ['approve', approveExpense],
    ['reject', rejectExpense],
  ])('%s: 423 и без изменений, если месяц операции закрыт', async (_name, handler) => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 9 });

    const res = await handler(makeRequest('http://localhost/api/expenses/1/x'), makeParams(1)) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Месяц закрыт/);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it.each([
    ['approve', approveExpense, 'approved'],
    ['reject', rejectExpense, 'rejected'],
  ])('%s: в открытом месяце ставит статус %s', async (_name, handler, expected) => {
    const res = await handler(makeRequest('http://localhost/api/expenses/1/x'), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(updateExpense.mock.calls[updateExpense.mock.calls.length - 1][0].data.status).toBe(expected);
  });

  it('404, если строки расхода нет', async () => {
    findUniqueExpense.mockResolvedValue(null);
    const res = await approveExpense(makeRequest('http://localhost/api/expenses/5/approve'), makeParams(5)) as unknown as { status: number };
    expect(res.status).toBe(404);
  });
});

// QA раунд 4, №12: PUT принимал любые status/category/amount и не смотрел на закрытый месяц.
describe('PUT /api/expenses/[id] — валидация и закрытый месяц', () => {
  function makePut(body: unknown, role = 'admin'): NextRequest {
    return new Request('http://localhost/api/expenses/1', {
      method: 'PUT',
      headers: { 'x-user-role': role, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  it('423, если месяц операции закрыт', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1 });
    const res = await putExpense(makePut({ amount: 999 }), makeParams(1)) as unknown as { status: number };
    expect(res.status).toBe(423);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it('404, если строки нет', async () => {
    findUniqueExpense.mockResolvedValue(null);
    const res = await putExpense(makePut({ amount: 1 }), makeParams(1)) as unknown as { status: number };
    expect(res.status).toBe(404);
  });

  it.each([
    ['status', { status: 'done' }, /Некорректный статус/],
    ['category', { category: 'salary' }, /rent или expense/],
    ['amount (отрицательная)', { amount: -5 }, /неотрицательным/],
    ['amount (не число)', { amount: 'abc' }, /неотрицательным/],
  ])('400 на некорректный %s', async (_label, body, pattern) => {
    const res = await putExpense(makePut(body), makeParams(1)) as unknown as { status: number; body: { error: string } };
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(pattern);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it('корректная правка проходит и сохраняет только переданные поля', async () => {
    const res = await putExpense(makePut({ category: 'rent', amount: 350000, pharmacyId: 2 }), makeParams(1)) as unknown as { status: number };
    expect(res.status).toBe(200);
    const data = updateExpense.mock.calls[updateExpense.mock.calls.length - 1][0].data;
    expect(data).toEqual({ category: 'rent', amount: '350000', pharmacyId: 2 });
  });

  it('бухгалтеру недоступно (403)', async () => {
    const res = await putExpense(makePut({ amount: 1 }, 'bookkeeper'), makeParams(1)) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
});
