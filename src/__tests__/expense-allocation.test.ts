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
    pharmacy: { findMany: vi.fn(), findUnique: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    employeePharmacy: { findMany: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
    userPharmacy: { findMany: vi.fn() },
    dailyRevenueEntry: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    dailyExpenseItem: { findMany: vi.fn() },
    attendanceShift: { findFirst: vi.fn() },
    cashMovement: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/revenue/route';
import { PUT } from '@/app/api/revenue/[id]/route';
import { GET as GET_NAMES } from '@/app/api/pharmacies/names/route';
import { loadCashBalance } from '@/lib/cash-balance-query';
import { resolveAllocatedPharmacyId, validateAllocatedPharmacies } from '@/lib/revenue-validation';

type Mock = ReturnType<typeof vi.fn>;
const findManyPharmacy = prisma.pharmacy.findMany as unknown as Mock;
const findUniquePharmacy = prisma.pharmacy.findUnique as unknown as Mock;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as Mock;
const findUniqueRevenueEntry = prisma.dailyRevenueEntry.findUnique as unknown as Mock;
const findManyRevenueEntry = prisma.dailyRevenueEntry.findMany as unknown as Mock;
const findManyExpenseItem = prisma.dailyExpenseItem.findMany as unknown as Mock;
const findManyCashMovement = prisma.cashMovement.findMany as unknown as Mock;
const findManyUserPharmacy = prisma.userPharmacy.findMany as unknown as Mock;
const findUniqueUser = prisma.user.findUnique as unknown as Mock;
const transaction = prisma.$transaction as unknown as Mock;

let createMany: Mock;

function makeRequest(method: string, url: string, body: unknown, opts: { role?: string; userId?: number } = {}): NextRequest {
  return new Request(url, {
    method,
    headers: {
      'x-user-role': opts.role ?? 'admin',
      ...(opts.userId ? { 'x-user-id': String(opts.userId) } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const baseBody = {
  pharmacyId: 1,
  date: '2026-06-26',
  cashRevenue: 30000,
  terminalRevenue: 10000,
  employeeName: 'Etel Achmetov',
};

beforeEach(() => {
  vi.clearAllMocks();
  findManyPharmacy.mockReset().mockResolvedValue([]);
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  findUniqueRevenueEntry.mockReset();
  findManyExpenseItem.mockReset().mockResolvedValue([]);
  findManyUserPharmacy.mockReset().mockResolvedValue([]);
  findUniqueUser.mockReset().mockResolvedValue({ isActive: true });
  createMany = vi.fn();
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      dailyRevenueEntry: {
        create: vi.fn().mockResolvedValue({ id: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 1, expenseItems: [] }),
        update: vi.fn().mockResolvedValue({ id: 1, expenseItems: [] }),
      },
      dailyExpenseItem: { createMany, deleteMany: vi.fn() },
    })
  );
});

describe('resolveAllocatedPharmacyId', () => {
  it('пусто или аптека записи → null (расход остаётся за аптекой записи)', () => {
    expect(resolveAllocatedPharmacyId({ category: 'repairs' }, 1)).toBeNull();
    expect(resolveAllocatedPharmacyId({ category: 'repairs', allocatedPharmacyId: '' }, 1)).toBeNull();
    expect(resolveAllocatedPharmacyId({ category: 'repairs', allocatedPharmacyId: null }, 1)).toBeNull();
    expect(resolveAllocatedPharmacyId({ category: 'repairs', allocatedPharmacyId: 1 }, 1)).toBeNull();
    expect(resolveAllocatedPharmacyId({ category: 'repairs', allocatedPharmacyId: '1' }, 1)).toBeNull();
  });

  it('другая аптека → её id', () => {
    expect(resolveAllocatedPharmacyId({ category: 'repairs', allocatedPharmacyId: 2 }, 1)).toBe(2);
    expect(resolveAllocatedPharmacyId({ category: 'repairs', allocatedPharmacyId: '2' }, 1)).toBe(2);
  });

  it.each(['pharmaBonus', 'employeeAdvance', 'employeeSurcharge'])('для %s перенос не применяется', (category) => {
    expect(resolveAllocatedPharmacyId({ category, allocatedPharmacyId: 2 }, 1)).toBeNull();
  });
});

describe('validateAllocatedPharmacies', () => {
  it('без переноса не обращается к базе', async () => {
    expect(await validateAllocatedPharmacies([{ category: 'repairs' }, { category: 'charity', allocatedPharmacyId: 1 }], 1)).toBeNull();
    expect(findManyPharmacy).not.toHaveBeenCalled();
  });

  it('принимает существующую активную аптеку', async () => {
    findManyPharmacy.mockResolvedValue([{ id: 2, isActive: true }]);
    expect(await validateAllocatedPharmacies([{ category: 'repairs', allocatedPharmacyId: 2 }], 1)).toBeNull();
  });

  it('отклоняет несуществующую аптеку', async () => {
    findManyPharmacy.mockResolvedValue([]);
    expect(await validateAllocatedPharmacies([{ category: 'repairs', allocatedPharmacyId: 99 }], 1)).toMatch(/не найдена/);
  });

  it('отклоняет неактивную аптеку, но допускает уже использованную записью ранее', async () => {
    findManyPharmacy.mockResolvedValue([{ id: 2, isActive: false }]);
    expect(await validateAllocatedPharmacies([{ category: 'repairs', allocatedPharmacyId: 2 }], 1)).toMatch(/неактивную/);
    expect(await validateAllocatedPharmacies([{ category: 'repairs', allocatedPharmacyId: 2 }], 1, [2])).toBeNull();
  });

  it.each(['pharmaBonus', 'employeeAdvance', 'employeeSurcharge'])('не даёт отнести %s на другую аптеку', async (category) => {
    expect(await validateAllocatedPharmacies([{ category, allocatedPharmacyId: 2 }], 1)).toMatch(/нельзя отнести/);
  });

  it('некорректное значение отклоняется', async () => {
    expect(await validateAllocatedPharmacies([{ category: 'repairs', allocatedPharmacyId: 'abc' }], 1)).toMatch(/Недопустимая аптека/);
  });
});

describe('POST /api/revenue — расход за другую аптеку', () => {
  it('сохраняет allocatedPharmacyId и не трогает аптеку записи', async () => {
    findManyPharmacy.mockResolvedValue([{ id: 2, isActive: true }]);

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', {
        ...baseBody,
        expenseItems: [
          { amount: '9000', category: 'repairs', allocatedPharmacyId: 2 },
          { amount: '500', category: 'charity' },
        ],
      })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
    const rows = createMany.mock.calls[0][0].data as { category: string; allocatedPharmacyId: number | null }[];
    expect(rows.find((r) => r.category === 'repairs')!.allocatedPharmacyId).toBe(2);
    expect(rows.find((r) => r.category === 'charity')!.allocatedPharmacyId).toBeNull();
  });

  it('аптека назначения совпала с аптекой записи → хранится null', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', {
        ...baseBody,
        expenseItems: [{ amount: '9000', category: 'repairs', allocatedPharmacyId: 1 }],
      })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
    expect(createMany.mock.calls[0][0].data[0].allocatedPharmacyId).toBeNull();
  });

  it('отклоняет перенос бонусов на другую аптеку', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', {
        ...baseBody,
        expenseItems: [{ amount: '9000', category: 'pharmaBonus', allocatedPharmacyId: 2 }],
      })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/нельзя отнести/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('отклоняет несуществующую аптеку назначения', async () => {
    findManyPharmacy.mockResolvedValue([]);

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', {
        ...baseBody,
        expenseItems: [{ amount: '9000', category: 'repairs', allocatedPharmacyId: 77 }],
      })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('бонус одной суммой (отдельное поле формы) сохраняется за аптекой записи', async () => {
    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', {
        ...baseBody,
        expenseItems: [{ amount: '4000', category: 'pharmaBonus', comment: 'за месяц' }],
      })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
    const row = createMany.mock.calls[0][0].data[0];
    expect(row.category).toBe('pharmaBonus');
    expect(row.allocatedPharmacyId).toBeNull();
  });

  it('заведующий аптеки может отнести расход на чужую аптеку', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }]);
    findManyPharmacy.mockResolvedValue([{ id: 2, isActive: true }]);

    const res = await POST(
      makeRequest(
        'POST',
        'http://localhost/api/revenue',
        { ...baseBody, expenseItems: [{ amount: '9000', category: 'repairs', allocatedPharmacyId: 2 }] },
        { role: 'manager', userId: 5 }
      )
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
    expect(createMany.mock.calls[0][0].data[0].allocatedPharmacyId).toBe(2);
  });
});

describe('PUT /api/revenue/[id] — расход за другую аптеку', () => {
  const params = { params: Promise.resolve({ id: '1' }) };
  const existing = { id: 1, pharmacyId: 1, date: new Date('2026-06-26'), status: 'approved', submittedById: null, employeeId: null, shiftType: null };

  beforeEach(() => {
    findUniqueRevenueEntry.mockResolvedValue(existing);
  });

  it('пересохраняет строки с allocatedPharmacyId', async () => {
    findManyPharmacy.mockResolvedValue([{ id: 2, isActive: true }]);
    findManyExpenseItem.mockResolvedValue([]);

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', {
        expenseItems: [{ amount: '9000', category: 'repairs', allocatedPharmacyId: 2 }],
      }),
      params
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(createMany.mock.calls[0][0].data[0].allocatedPharmacyId).toBe(2);
  });

  it('неактивная аптека, на которую расход уже был отнесён раньше, не мешает пересохранению', async () => {
    findManyPharmacy.mockResolvedValue([{ id: 2, isActive: false }]);
    findManyExpenseItem.mockResolvedValue([{ allocatedPharmacyId: 2 }]);

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', {
        expenseItems: [{ amount: '9000', category: 'repairs', allocatedPharmacyId: 2 }],
      }),
      params
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });

  it('смена аптеки записи на ту, что указана в «за аптеку», обнуляет перенос', async () => {
    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', {
        pharmacyId: 2,
        expenseItems: [{ amount: '9000', category: 'repairs', allocatedPharmacyId: 2 }],
      }),
      params
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(createMany.mock.calls[0][0].data[0].allocatedPharmacyId).toBeNull();
  });

  it('отклоняет перенос доплаты на другую аптеку', async () => {
    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', {
        expenseItems: [{ amount: '100', category: 'employeeSurcharge', employeeId: 3, allocatedPharmacyId: 2 }],
      }),
      params
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/нельзя отнести/);
  });
});

describe('GET /api/pharmacies/names', () => {
  it('заведующему отдаёт все аптеки (id, название, активность), а не только свои', async () => {
    findManyPharmacy.mockResolvedValue([
      { id: 1, name: 'А', isActive: true },
      { id: 2, name: 'Б', isActive: true },
    ]);

    const res = await GET_NAMES(
      makeRequest('GET', 'http://localhost/api/pharmacies/names', undefined, { role: 'manager', userId: 5 })
    ) as unknown as { status: number; body: unknown[] };

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(findManyPharmacy).toHaveBeenCalledWith({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  });
});

// Касса уменьшается у аптеки, которая заплатила (аптека записи), независимо от того, за какую
// аптеку числится расход в месячном отчёте.
describe('касса при расходе за другую аптеку', () => {
  it('расход, отнесённый на аптеку Б, всё равно уменьшает кассу аптеки А (плательщика)', async () => {
    findUniquePharmacy.mockResolvedValue({ id: 1, cashOpeningDate: new Date('2026-06-01') });
    findManyRevenueEntry.mockResolvedValue([
      {
        id: 10,
        date: new Date('2026-06-10T00:00:00.000Z'),
        status: 'approved',
        excludedFromReport: false,
        cashRevenue: 20000,
        terminalRevenue: 0,
        kaspiRevenue: 0,
        expenseItems: [{ category: 'repairs', amount: 9000, allocatedPharmacyId: 2 }],
      },
    ]);
    findManyCashMovement.mockResolvedValue([]);

    const result = await loadCashBalance(1, '2026-06-01', '2026-06-30');

    expect(result).not.toBeNull();
    expect(findManyRevenueEntry.mock.calls[0][0].where.pharmacyId).toBe(1);
    const day = result!.days.find((d) => d.date === '2026-06-10')!;
    expect(day.closingBalance).toBe(11000);
  });
});
