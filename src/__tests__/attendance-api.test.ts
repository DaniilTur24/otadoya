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
    employee: { findUnique: vi.fn() },
    employeePharmacy: { findFirst: vi.fn() },
    userPharmacy: { findMany: vi.fn() },
    attendanceShift: { create: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
    dailyRevenueEntry: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/attendance/route';

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const findFirstEmployeePharmacy = prisma.employeePharmacy.findFirst as unknown as ReturnType<typeof vi.fn>;
const createShift = prisma.attendanceShift.create as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;
const findFirstRevenueEntry = prisma.dailyRevenueEntry.findFirst as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/attendance', {
    method: 'POST',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  findUniqueEmployee.mockReset();
  // По умолчанию — привязан, если тест вообще передаёт pharmacyId (без него проверка не
  // вызывается вовсе, см. отдельный describe ниже).
  findFirstEmployeePharmacy.mockReset().mockResolvedValue({ employeeId: 28, pharmacyId: 2 });
  createShift.mockReset().mockResolvedValue({ id: 1 });
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  findFirstRevenueEntry.mockReset().mockResolvedValue(null);
});

describe('POST /api/attendance — запрет для сменных типов сотрудников', () => {
  it.each(['seller', 'manager_trading'])('отклоняет отметку табеля для %s', async (employeeType) => {
    findUniqueEmployee.mockResolvedValue({ employeeType });

    const res = await POST(
      makeRequest({ employeeId: 19, date: '2026-06-26' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/смену в записи выручки/);
    expect(createShift).not.toHaveBeenCalled();
  });

  it.each(['manager_fixed', 'cleaner', 'office', 'pharmacy_manager', 'seller_five_day_fixed'])('разрешает отметку табеля для %s', async (employeeType) => {
    findUniqueEmployee.mockResolvedValue({ employeeType });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });

  it('разрешает отметку табеля для manager_trading с включённым fiveDayViaAttendance', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_trading', fiveDayViaAttendance: true });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });
});

describe('POST /api/attendance — конфликт с сменой в записи выручки (seller_five_day_fixed)', () => {
  it('блокирует отметку табеля с 409, если на эту дату уже назначена смена в выручке', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller_five_day_fixed' });
    findFirstRevenueEntry.mockResolvedValue({ id: 99, date: new Date('2026-06-26') });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/уже назначена смена в записи выручки/);
    expect(createShift).not.toHaveBeenCalled();
  });
});

describe('POST /api/attendance — сотрудник должен быть привязан к аптеке', () => {
  it('отклоняет отметку, если сотрудник не привязан к переданной аптеке', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'cleaner' });
    findFirstEmployeePharmacy.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26', pharmacyId: 99 })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/не привязан к этой аптеке/);
    expect(createShift).not.toHaveBeenCalled();
  });

  it('не проверяет привязку для офисных отметок без аптеки', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'office' });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
    expect(findFirstEmployeePharmacy).not.toHaveBeenCalled();
  });
});

describe('POST /api/attendance — запрет будущих дат', () => {
  it('отклоняет отметку будущей датой', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'cleaner' });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2099-01-15', pharmacyId: 2 })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/будущей датой/);
    expect(createShift).not.toHaveBeenCalled();
  });

  it('разрешает отметку сегодняшней датой', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'cleaner' });
    const today = new Date().toISOString().slice(0, 10);

    const res = await POST(
      makeRequest({ employeeId: 28, date: today, pharmacyId: 2 })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });
});

// Зарплата за закрытый месяц зафиксирована снимком. Новая отметка табеля разошлась бы
// с этим снимком, поэтому запись в закрытый период запрещена — как и для выручки.
describe('POST /api/attendance — запрет записи в закрытый месяц', () => {
  it('отклоняет отметку в закрытом месяце с 423', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'cleaner' });
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 6 });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Месяц закрыт/);
    expect(createShift).not.toHaveBeenCalled();
  });

  it('проверяет месяц самой отметки, а не текущий', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'cleaner' });
    findUniqueClosedMonth.mockResolvedValue(null);

    await POST(makeRequest({ employeeId: 28, date: '2026-03-15' }));

    const where = findUniqueClosedMonth.mock.calls.at(-1)![0].where;
    expect(where).toEqual({ year_month: { year: 2026, month: 3 } });
  });
});
