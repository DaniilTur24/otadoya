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
    workingCalendar: { upsert: vi.fn(), findMany: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { GET, PUT } from '@/app/api/working-calendar/route';

const upsert = prisma.workingCalendar.upsert as unknown as ReturnType<typeof vi.fn>;
const findManyCalendar = prisma.workingCalendar.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeGetRequest(role: string, year = 2026): NextRequest {
  return new Request(`http://localhost/api/working-calendar?year=${year}`, {
    headers: { 'x-user-role': role },
  }) as unknown as NextRequest;
}

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/working-calendar', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ month: 8, workingDays: 21 });
  findManyCalendar.mockResolvedValue([{ month: 8, workingDays: 21 }]);
  findUniqueClosedMonth.mockResolvedValue(null);
});

describe('GET /api/working-calendar', () => {
  // Табель посещаемости (страница /attendance) показывает предупреждение о превышении
  // нормы дней бухгалтеру — без доступа на чтение этого пришлось бы отправлять его
  // отдельно в /settings/working-calendar на каждую проверку.
  it('доступен бухгалтеру', async () => {
    const res = await GET(makeGetRequest('bookkeeper')) as unknown as { status: number };
    expect(res.status).toBe(200);
  });

  it('доступен админу', async () => {
    const res = await GET(makeGetRequest('admin')) as unknown as { status: number };
    expect(res.status).toBe(200);
  });

  it('недоступен заведующему', async () => {
    const res = await GET(makeGetRequest('manager')) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/working-calendar', () => {
  it('сохраняет рабочие дни для открытого месяца', async () => {
    const res = await PUT(makeRequest({ year: 2026, month: 8, workingDays: 21 })) as unknown as {
      status: number;
      body: { workingDays: number };
    };

    expect(res.status).toBe(200);
    expect(res.body.workingDays).toBe(21);
    expect(upsert).toHaveBeenCalled();
  });

  // Число рабочих дней — делитель оклада за пятидневку, то есть историческая величина месяца.
  // Изменить её в закрытом месяце значит переписать уже зафиксированную зарплату.
  it('отклоняет изменение закрытого месяца с 423', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 8 });

    const res = await PUT(makeRequest({ year: 2026, month: 8, workingDays: 21 })) as unknown as {
      status: number;
      body: { error: string };
    };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Месяц закрыт/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('проверяет закрытость именно того месяца, который правят', async () => {
    await PUT(makeRequest({ year: 2025, month: 3, workingDays: 20 }));

    expect(findUniqueClosedMonth.mock.calls.at(-1)![0].where).toEqual({
      year_month: { year: 2025, month: 3 },
    });
  });

  it('отклоняет некорректные значения до проверки закрытого месяца', async () => {
    const res = await PUT(makeRequest({ year: 2026, month: 8, workingDays: 40 })) as unknown as {
      status: number;
    };

    expect(res.status).toBe(400);
    expect(findUniqueClosedMonth).not.toHaveBeenCalled();
  });
});
