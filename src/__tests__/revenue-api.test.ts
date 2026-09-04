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
    employeePharmacy: { findMany: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
    userPharmacy: { findMany: vi.fn() },
    dailyRevenueEntry: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    dailyExpenseItem: { findMany: vi.fn() },
    attendanceShift: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/revenue-delete-impact', () => ({
  computeRevenueDeleteImpact: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { computeRevenueDeleteImpact } from '@/lib/revenue-delete-impact';
import { POST } from '@/app/api/revenue/route';
import { PUT, DELETE } from '@/app/api/revenue/[id]/route';

const mockComputeImpact = computeRevenueDeleteImpact as unknown as ReturnType<typeof vi.fn>;

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const findManyEmployeePharmacy = prisma.employeePharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;
const findUniqueRevenueEntry = prisma.dailyRevenueEntry.findUnique as unknown as ReturnType<typeof vi.fn>;
const findFirstRevenueEntry = prisma.dailyRevenueEntry.findFirst as unknown as ReturnType<typeof vi.fn>;
const findFirstAttendanceShift = prisma.attendanceShift.findFirst as unknown as ReturnType<typeof vi.fn>;
const updateRevenueEntry = prisma.dailyRevenueEntry.update as unknown as ReturnType<typeof vi.fn>;
const deleteRevenueEntry = prisma.dailyRevenueEntry.delete as unknown as ReturnType<typeof vi.fn>;
const findManyExpenseItem = prisma.dailyExpenseItem.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyUserPharmacy = prisma.userPharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

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
  findUniqueEmployee.mockReset();
  findManyEmployeePharmacy.mockReset().mockResolvedValue([]);
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  findUniqueRevenueEntry.mockReset();
  findFirstRevenueEntry.mockReset().mockResolvedValue(null);
  findFirstAttendanceShift.mockReset().mockResolvedValue(null);
  findManyUserPharmacy.mockReset().mockResolvedValue([]);
  findUniqueUser.mockReset().mockResolvedValue({ isActive: true });
  updateRevenueEntry.mockReset().mockResolvedValue({ id: 1, expenseItems: [] });
  deleteRevenueEntry.mockReset().mockResolvedValue({ id: 1 });
  findManyExpenseItem.mockReset().mockResolvedValue([]);
  mockComputeImpact.mockReset().mockResolvedValue(null);
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

  it('пропускает смену для seller_five_day_fixed', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller_five_day_fixed' });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 30, shiftType: 'full_day' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });
});

describe('POST /api/revenue — конфликт с табелем (seller_five_day_fixed)', () => {
  it('блокирует смену с 409, если на эту дату уже отмечен табель', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller_five_day_fixed' });
    findFirstAttendanceShift.mockResolvedValue({ id: 5 });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, employeeId: 30, shiftType: 'full_day' })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/уже отмечен табель/);
    expect(transaction).not.toHaveBeenCalled();
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

  it('отклоняет новую запись в уже закрытый месяц', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1 });

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', baseBody)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/закрыт/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('разрешает бэкдейтинг в открытый месяц', async () => {
    findUniqueClosedMonth.mockResolvedValue(null);

    const res = await POST(
      makeRequest('POST', 'http://localhost/api/revenue', { ...baseBody, date: '2020-01-15' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
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

  it('заведующий не может сам подтвердить свою запись через status в PUT', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'pending', submittedById: 5, date: new Date('2026-06-26'),
    });
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }]);

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { status: 'approved' }, { role: 'manager', userId: 5 }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    const lastCall = updateRevenueEntry.mock.calls[updateRevenueEntry.mock.calls.length - 1];
    expect(lastCall[0].data.status).toBeUndefined();
  });

  it('заведующий не может скрыть свою запись из отчёта через excludedFromReport в PUT', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'pending', submittedById: 5, date: new Date('2026-06-26'),
    });
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }]);

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { excludedFromReport: true }, { role: 'manager', userId: 5 }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    const lastCall = updateRevenueEntry.mock.calls[updateRevenueEntry.mock.calls.length - 1];
    expect(lastCall[0].data.excludedFromReport).toBeUndefined();
  });

  it('бухгалтер может подтвердить запись через status в PUT', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'pending', submittedById: 5, date: new Date('2026-06-26'),
    });

    const res = await PUT(
      makeRequest('PUT', 'http://localhost/api/revenue/1', { status: 'approved' }, { role: 'bookkeeper' }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    const lastCall = updateRevenueEntry.mock.calls[updateRevenueEntry.mock.calls.length - 1];
    expect(lastCall[0].data.status).toBe('approved');
  });
});

// Regression QA раунд 3, находка №1: аванс/доплата другому сотруднику хранится как дочерняя
// строка расходов этой же записи (DailyExpenseItem.employeeId), и раньше удаление записи
// стирало её молча вместе с записью (onDelete: Cascade) — получатель уже получил деньги
// наличными, но при следующем расчёте зарплаты аванс больше не вычитался.
describe('DELETE /api/revenue/[id] — защита авансов/доплат другому сотруднику', () => {
  function makeParams(id = 1) {
    return { params: Promise.resolve({ id: String(id) }) };
  }
  function makeDeleteRequest(url: string, opts: { role?: string; userId?: number } = {}): NextRequest {
    return new Request(url, {
      method: 'DELETE',
      headers: {
        'x-user-role': opts.role ?? 'admin',
        ...(opts.userId ? { 'x-user-id': String(opts.userId) } : {}),
      },
    }) as unknown as NextRequest;
  }

  it('404, если запись не найдена', async () => {
    findUniqueRevenueEntry.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1'), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(404);
  });

  it('423, если месяц закрыт', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findUniqueClosedMonth.mockResolvedValue({ id: 1 });

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1'), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(423);
    expect(deleteRevenueEntry).not.toHaveBeenCalled();
  });

  it('удаляет сразу, если в записи нет аванса/доплаты', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findManyExpenseItem.mockResolvedValue([]);

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1'), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteRevenueEntry).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('без ?force=1 возвращает 409 со списком получателей и НЕ удаляет запись', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findManyExpenseItem.mockResolvedValue([
      { category: 'employeeAdvance', amount: '20000', employee: { name: 'Бота' } },
    ]);

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1'), makeParams(1)) as unknown as {
      status: number;
      body: { error: string; items: { employeeName: string; category: string; amount: number }[] };
    };

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('revenue_delete_impact');
    expect(res.body.items).toEqual([{ employeeName: 'Бота', category: 'employeeAdvance', amount: 20000 }]);
    expect(deleteRevenueEntry).not.toHaveBeenCalled();
  });

  it('без ?force=1 возвращает 409 с impact, даже если авансов/доплат нет — есть влияние на выручку/зарплату', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findManyExpenseItem.mockResolvedValue([]);
    mockComputeImpact.mockResolvedValue({
      revenue: { pharmacyName: 'Тестовая аптека QA', before: 500000, after: 460000 },
      employees: [{ employeeId: 19, employeeName: 'Etel', before: 100000, after: 87000 }],
      partial: true,
    });

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1'), makeParams(1)) as unknown as {
      status: number;
      body: { error: string; impact: { revenue: unknown; employees: unknown[]; partial: boolean } };
    };

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('revenue_delete_impact');
    expect(res.body.impact.revenue).toEqual({ pharmacyName: 'Тестовая аптека QA', before: 500000, after: 460000 });
    expect(res.body.impact.employees).toHaveLength(1);
    expect(deleteRevenueEntry).not.toHaveBeenCalled();
  });

  it('с ?force=1 удаляет запись, даже если внутри есть аванс/доплата', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    findManyExpenseItem.mockResolvedValue([
      { category: 'employeeSurcharge', amount: '5000', employee: { name: 'Айгерим' } },
    ]);

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1?force=1'), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteRevenueEntry).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('не считает препятствием обычную (не employeeAdvance/Surcharge) строку расходов', async () => {
    findUniqueRevenueEntry.mockResolvedValue({
      id: 1, pharmacyId: 1, status: 'approved', submittedById: null, date: new Date('2026-06-26'),
    });
    // dailyExpenseItem.findMany сам фильтрует по category в запросе — здесь просто
    // подтверждаем, что при пустом результате (обычные категории отфильтрованы) удаление проходит.
    findManyExpenseItem.mockResolvedValue([]);

    const res = await DELETE(makeDeleteRequest('http://localhost/api/revenue/1'), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
  });
});
