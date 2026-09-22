import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    headers: Record<string, string>;
    constructor(_body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.status = init?.status ?? 200;
      this.headers = init?.headers ?? {};
    }
    static json(data: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body: data };
    }
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyRevenueEntry: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/cash-report-excel', () => ({
  buildCashReportWorkbook: vi.fn().mockResolvedValue({ xlsx: { writeBuffer: async () => new ArrayBuffer(0) } }),
}));

import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/reports/cash-export/route';

const findMany = prisma.dailyRevenueEntry.findMany as unknown as ReturnType<typeof vi.fn>;

function makeRequest(query = ''): NextRequest {
  return new Request(`http://localhost/api/reports/cash-export${query}`, {
    method: 'GET',
    headers: { 'x-user-role': 'bookkeeper' },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
});

// QA раунд 4, №3: сверка кассы — это реальные наличные. Раньше по умолчанию брались все записи,
// кроме pending, и отклонённые вместе с исключёнными из отчёта дублями попадали в «ИТОГО».
// На проверке (pending) в счёт идёт: деньги из кассы уже вышли, подтверждение — это workflow-шлюз,
// а не факт о движении денег (согласовано отдельно от находки №3, которая была про
// rejected/excludedFromReport, а не про pending).
describe('GET /api/reports/cash-export — без отклонённых и исключённых из отчёта записей', () => {
  it('по умолчанию не пускает rejected, но пускает pending; excludedFromReport всегда false', async () => {
    await GET(makeRequest());

    const where = findMany.mock.calls[findMany.mock.calls.length - 1][0].where;
    expect(where.status).toEqual({ not: 'rejected' });
    expect(where.excludedFromReport).toBe(false);
  });

  it('явный ?status= уважается, но исключённые из отчёта всё равно не попадают', async () => {
    await GET(makeRequest('?status=pending'));

    const where = findMany.mock.calls[findMany.mock.calls.length - 1][0].where;
    expect(where.status).toBe('pending');
    expect(where.excludedFromReport).toBe(false);
  });

  it('фильтры по аптеке и периоду сохраняются', async () => {
    await GET(makeRequest('?pharmacyId=2&from=2026-09-01&to=2026-09-30'));

    const where = findMany.mock.calls[findMany.mock.calls.length - 1][0].where;
    expect(where.pharmacyId).toBe(2);
    expect(where.date.gte).toEqual(new Date('2026-09-01T00:00:00'));
    expect(where.date.lte).toEqual(new Date('2026-09-30T23:59:59'));
  });

  it('заведующей экспорт недоступен', async () => {
    const res = await GET(
      new Request('http://localhost/api/reports/cash-export', { headers: { 'x-user-role': 'manager' } }) as unknown as NextRequest
    ) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
});
