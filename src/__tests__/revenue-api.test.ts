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
    employee: { findUnique: vi.fn() },
    employeePharmacy: { findMany: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
    userPharmacy: { findMany: vi.fn() },
    dailyRevenueEntry: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/revenue/route';
import { PUT } from '@/app/api/revenue/[id]/route';

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const findManyEmployeePharmacy = prisma.employeePharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;
const findUniqueRevenueEntry = prisma.dailyRevenueEntry.findUnique as unknown as ReturnType<typeof vi.fn>;
const findFirstRevenueEntry = prisma.dailyRevenueEntry.findFirst as unknown as ReturnType<typeof vi.fn>;
const updateRevenueEntry = prisma.dailyRevenueEntry.update as unknown as ReturnType<typeof vi.fn>;
const findManyUserPharmacy = prisma.userPharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(method: string, url: string, body: unknown, opts: { role?: string; userId?: number } = {}): Request {
  return new Request(url, {
    method,
    headers: {
      'x-user-role': opts.role ?? 'admin',
      ...(opts.userId ? { 'x-user-id': String(opts.userId) } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  pharmacyId: 1,
  date: '2026-06-26',
  cashRevenue: 30000,
  terminalRevenue: 10000,
  employeeName: 'Etel Achmetov',
};

beforeEach(() => {
  findUniqueEmployee.mockReset();
  findManyEmployeePharmacy.mockReset().mockResolvedValue([]);
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  findUniqueRevenueEntry.mockReset();
  findFirstRevenueEntry.mockReset().mockResolvedValue(null);
  findManyUserPharmacy.mockReset().mockResolvedValue([]);
  updateRevenueEntry.mockReset().mockResolvedValue({ id: 1, expenseItems: [] });
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      dailyRevenueEntry: {
        create: vi.fn().mockResolvedValue({ id: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 1, expenseItems: [] }),
        update: vi.fn().mockResolvedValue({ id: 1, expenseItems: [] }),
      },
      dailyExpenseItem: { createMany: vi.fn(), deleteMany: vi.fn() },
    })
  );
});

describe('POST /api/revenue — запрет смены для табельных типов сотрудников', () => {
  it('отклоняет смену для manager_fixed (учитывается через табель, а не через смену)', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_fixed' });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 28, shiftType: 'full_day' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/табел/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['cleaner', 'office', 'pharmacy_manager'])('отклоняет смену для %s', async (employeeType) => {
    findUniqueEmployee.mockResolvedValue({ employeeType });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 28, shiftType: 'day' })
    ) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('пропускает смену для seller', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 19, shiftType: 'full_day' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });

  it('пропускает manager_fixed, если смена не указана (employeeId без shiftType)', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_fixed' });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 28 })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });
});

describe('POST /api/revenue — дополнительные проверки', () => {
  it('отклоняет вторую смену тому же сотруднику на ту же дату', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });
    findFirstRevenueEntry.mockResolvedValue({ id: 99 });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 19, shiftType: 'full_day' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/уже есть смена/);
  });

  it('отклоняет отрицательную выручку наличными', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, cashRevenue: -5000 })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/отрицательным/);
  });
});

describe('PUT /api/revenue/[id] — запрет смены для табельных типов сотрудников', () => {
  function makeParams(id = 1) {
    return { params: Promise.resolve({ id: String(id) }) };
  }

  it('отклоняет смену для manager_fixed при редактировании', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_fixed' });

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { employeeId: 28, shiftType: 'full_day' }),
      makeParams(1)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/табел/);
  });

  it('отклоняет, если смена уже была установлена ранее, а сейчас меняется только сотрудник на manager_fixed', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
      shiftType: 'full_day', employeeId: 19,
    });
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_fixed' });

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { employeeId: 28 }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('отклоняет вторую смену тому же сотруднику на ту же дату при редактировании', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
      shiftType: null, employeeId: null,
    });
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });
    findFirstRevenueEntry.mockResolvedValue({ id: 42 });

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { employeeId: 19, shiftType: 'day' }),
      makeParams(1)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/уже есть смена/);
  });

  it('отклоняет отрицательную выручку при редактировании', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { cashRevenue: -1 }),
      makeParams(1)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/отрицательным/);
  });

  it('отклоняет перенос записи датой в уже закрытый месяц', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findUniqueClosedMonth.mockImplementation(({ where }: { where: { year_month: { year: number; month: number } } }) =>
      Promise.resolve(where.year_month.month === 5 ? { id: 1 } : null)
    );

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { date: '2026-05-15' }),
      makeParams(1)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/закрыт/);
  });

  it('заведующий не может перенести запись на чужую аптеку', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'pending', submittedById: 5, date: new Date('2026-06-26'),
    });
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }]);

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { pharmacyId: 2 }, { role: 'manager', userId: 5 }),
      makeParams(1)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Нет доступа/);
  });

  it('заведующий может перенести запись на свою же другую аптеку', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'pending', submittedById: 5, date: new Date('2026-06-26'),
    });
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }, { pharmacyId: 2 }]);

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { pharmacyId: 2 }, { role: 'manager', userId: 5 }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });
});
