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
    transactionImportRule: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/transaction-import-rules/route';
import { PUT } from '@/app/api/transaction-import-rules/[id]/route';

const createRule = prisma.transactionImportRule.create as unknown as ReturnType<typeof vi.fn>;
const updateRule = prisma.transactionImportRule.update as unknown as ReturnType<typeof vi.fn>;
const findUniqueRule = prisma.transactionImportRule.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeRequest(method: string, body: unknown): NextRequest {
  return new Request('http://localhost/api/transaction-import-rules', {
    method,
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  createRule.mockReset().mockResolvedValue({ id: 1 });
  updateRule.mockReset().mockResolvedValue({ id: 1 });
  findUniqueRule.mockReset().mockResolvedValue({ matchType: 'contains', pattern: 'аптека' });
});

describe('POST /api/transaction-import-rules — защита от ReDoS', () => {
  it('отклоняет катастрофически вложенный паттерн ((a+)+)', async () => {
    const res = await POST(
      makeRequest('POST', { name: 'r', pattern: '(a+)+$', matchType: 'regex', distributionType: 'split_equally' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/вложенные повторения/);
    expect(createRule).not.toHaveBeenCalled();
  });

  it('отклоняет синтаксически некорректное регулярное выражение', async () => {
    const res = await POST(
      makeRequest('POST', { name: 'r', pattern: '(unclosed', matchType: 'regex', distributionType: 'split_equally' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Некорректное регулярное выражение/);
  });

  it('принимает безопасный regex-паттерн', async () => {
    const res = await POST(
      makeRequest('POST', { name: 'r', pattern: 'аптека №\\d+', matchType: 'regex', distributionType: 'split_equally' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
    expect(createRule).toHaveBeenCalled();
  });

  it('не проверяет паттерн как regex, если matchType = contains', async () => {
    const res = await POST(
      makeRequest('POST', { name: 'r', pattern: '(a+)+$', matchType: 'contains', distributionType: 'split_equally' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });
});

describe('PUT /api/transaction-import-rules/[id] — защита от ReDoS учитывает текущее состояние', () => {
  it('отклоняет смену matchType на regex с уже опасным паттерном', async () => {
    findUniqueRule.mockResolvedValue({ matchType: 'contains', pattern: '(a+)+' });

    const res = await PUT(
      makeRequest('PUT', { matchType: 'regex' }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/вложенные повторения/);
    expect(updateRule).not.toHaveBeenCalled();
  });

  it('отклоняет смену паттерна на опасный у уже-regex правила (matchType не передан)', async () => {
    findUniqueRule.mockResolvedValue({ matchType: 'regex', pattern: 'safe' });

    const res = await PUT(
      makeRequest('PUT', { pattern: '(\\d+)*' }),
      makeParams()
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/вложенные повторения/);
  });

  it('не трогает БД для проверки, если ни pattern, ни matchType не меняются', async () => {
    const res = await PUT(
      makeRequest('PUT', { priority: 5 }),
      makeParams()
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(findUniqueRule).not.toHaveBeenCalled();
    expect(updateRule).toHaveBeenCalled();
  });

  it('разрешает смену matchType на contains без проверки regex', async () => {
    const res = await PUT(
      makeRequest('PUT', { matchType: 'contains' }),
      makeParams()
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(findUniqueRule).not.toHaveBeenCalled();
  });
});
