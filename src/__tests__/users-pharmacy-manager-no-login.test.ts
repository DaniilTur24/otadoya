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
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    employeePharmacy: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    dailyRevenueEntry: { count: vi.fn() },
    attendanceShift: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { GET, POST } from '@/app/api/users/route';
import { PUT, DELETE } from '@/app/api/users/[id]/route';

const findManyUser = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyEmployee = prisma.employee.findMany as unknown as ReturnType<typeof vi.fn>;
const findFirstEmployee = prisma.employee.findFirst as unknown as ReturnType<typeof vi.fn>;
const countRevenue = prisma.dailyRevenueEntry.count as unknown as ReturnType<typeof vi.fn>;
const countAttendance = prisma.attendanceShift.count as unknown as ReturnType<typeof vi.fn>;
const findManyEmployeePharmacy = prisma.employeePharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const deleteEmployee = prisma.employee.delete as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeGetRequest(): NextRequest {
  return new Request('http://localhost/api/users', {
    method: 'GET',
    headers: { 'x-user-role': 'admin' },
  }) as unknown as NextRequest;
}

function makePostRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/users', {
    method: 'POST',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makePutRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeDeleteRequest(url: string): NextRequest {
  return new Request(url, {
    method: 'DELETE',
    headers: { 'x-user-role': 'admin' },
  }) as unknown as NextRequest;
}

function makeParams(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  findManyUser.mockReset().mockResolvedValue([]);
  findManyEmployee.mockReset().mockResolvedValue([]);
  findFirstEmployee.mockReset();
  countRevenue.mockReset().mockResolvedValue(0);
  countAttendance.mockReset().mockResolvedValue(0);
  findManyEmployeePharmacy.mockReset().mockResolvedValue([]);
  deleteEmployee.mockReset();
  transaction.mockReset();
});

describe('POST /api/users — менеджер (pharmacy_manager) не получает логин', () => {
  it('создаёт только Employee, без User, даже без username/password', async () => {
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        employee: {
          create: vi.fn().mockResolvedValue({ id: 5 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 5, name: 'Иванов', isActive: true, baseSalary: '100000', employeeType: 'pharmacy_manager',
            ladderPremiumEnabled: false, managerBonusShareEnabled: false, allowance: '0', allowanceDescription: '',
            pharmacies: [],
          }),
        },
        employeePharmacy: { createMany: vi.fn() },
      })
    );

    const res = await POST(makePostRequest({
      displayName: 'Иванов', employeeType: 'pharmacy_manager', baseSalary: 100000,
    })) as unknown as { status: number; body: { id: number; accountType: string; username: string } };

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(-5);
    expect(res.body.accountType).toBe('employee');
    expect(res.body.username).toBe('');
  });

  it('всё ещё требует username/password для заведующей (manager_trading)', async () => {
    const res = await POST(makePostRequest({
      displayName: 'Петрова', employeeType: 'manager_trading', baseSalary: 100000,
    })) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username, password/);
  });
});

describe('GET /api/users — менеджеры без логина попадают в общий список с отрицательным id', () => {
  it('объединяет User-записи и Employee-only менеджеров', async () => {
    findManyUser.mockResolvedValue([]);
    findManyEmployee.mockResolvedValue([
      {
        id: 5, name: 'Сидоров', isActive: true, baseSalary: '90000', employeeType: 'pharmacy_manager',
        ladderPremiumEnabled: true, managerBonusShareEnabled: false, allowance: '0', allowanceDescription: '',
        pharmacies: [{ pharmacy: { id: 1, name: 'Аптека 1' } }],
      },
    ]);

    const res = await GET(makeGetRequest()) as unknown as { status: number; body: Array<{ id: number; accountType: string }> };

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(-5);
    expect(res.body[0].accountType).toBe('employee');
    expect(findManyEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeType: 'pharmacy_manager', user: null } })
    );
  });
});

describe('PUT/DELETE /api/users/[id] — менеджер без логина адресуется отрицательным id', () => {
  it('PUT обновляет Employee напрямую по -id', async () => {
    findFirstEmployee.mockResolvedValue({ id: 5, employeeType: 'pharmacy_manager' });
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        employee: {
          update: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            id: 5, name: 'Сидоров', isActive: true, baseSalary: '95000', employeeType: 'pharmacy_manager',
            ladderPremiumEnabled: true, managerBonusShareEnabled: false, allowance: '0', allowanceDescription: '',
            pharmacies: [],
          }),
        },
        employeePharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
      })
    );

    const res = await PUT(
      makePutRequest('http://localhost/api/users/-5', { baseSalary: 95000 }),
      makeParams(-5)
    ) as unknown as { status: number; body: { id: number; baseSalary: number } };

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(-5);
    expect(res.body.baseSalary).toBe(95000);
  });

  it('PUT отклоняет попытку переключить менеджера в заведующие', async () => {
    findFirstEmployee.mockResolvedValue({ id: 5, employeeType: 'pharmacy_manager' });

    const res = await PUT(
      makePutRequest('http://localhost/api/users/-5', { employeeType: 'manager_trading' }),
      makeParams(-5)
    ) as unknown as { status: number };

    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('PUT отклоняет попытку переключить заведующего (id > 0) в менеджера', async () => {
    const res = await PUT(
      makePutRequest('http://localhost/api/users/1', { employeeType: 'pharmacy_manager' }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('DELETE удаляет Employee напрямую по -id, не трогая User', async () => {
    findFirstEmployee.mockResolvedValue({ id: 5, employeeType: 'pharmacy_manager' });

    const res = await DELETE(
      makeDeleteRequest('http://localhost/api/users/-5'),
      makeParams(-5)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});
