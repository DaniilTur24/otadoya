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

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn().mockReturnValue('hashed'),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    employee: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    employeePharmacy: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    userPharmacy: { createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { GET, POST } from '@/app/api/users/route';
import { PUT } from '@/app/api/users/[id]/route';

const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const findManyUser = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyEmployee = prisma.employee.findMany as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeGetRequest(): NextRequest {
  return new Request('http://localhost/api/users', { headers: { 'x-user-role': 'admin' } }) as unknown as NextRequest;
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

function makeParams(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  findUniqueUser.mockReset().mockResolvedValue(null);
  findManyUser.mockReset().mockResolvedValue([]);
  findManyEmployee.mockReset().mockResolvedValue([]);
  transaction.mockReset();
});

describe('GET /api/users — сериализует shiftRate', () => {
  it('отдаёт числом, когда ставка задана', async () => {
    findManyUser.mockResolvedValue([{
      id: 1, username: 'aliya', displayName: 'Алия', isActive: true, employeeId: 5,
      pharmacies: [],
      employee: { baseSalary: '150000', employeeType: 'manager_trading', ladderPremiumEnabled: false, managerBonusShareEnabled: true, allowance: '0', allowanceDescription: '', fiveDayViaAttendance: true, shiftRate: '12000' },
    }]);

    const res = await GET(makeGetRequest()) as unknown as { body: { shiftRate: number | null }[] };

    expect(res.body[0].shiftRate).toBe(12000);
  });

  it('отдаёт null, когда ставка не задана', async () => {
    findManyUser.mockResolvedValue([{
      id: 1, username: 'aliya', displayName: 'Алия', isActive: true, employeeId: 5,
      pharmacies: [],
      employee: { baseSalary: '150000', employeeType: 'manager_trading', ladderPremiumEnabled: false, managerBonusShareEnabled: true, allowance: '0', allowanceDescription: '', fiveDayViaAttendance: false, shiftRate: null },
    }]);

    const res = await GET(makeGetRequest()) as unknown as { body: { shiftRate: number | null }[] };

    expect(res.body[0].shiftRate).toBeNull();
  });
});

// Regression: manager_trading набирает пятидневные/суточные дни по фиксированной ставке за
// смену (см. useFixedFiveDayRate в salary-calculator.ts) — до этого фикса поля shiftRate у неё
// просто не существовало ни в API, ни в форме /users, и оплата тихо считалась по оладу/календарю.
describe('POST /api/users — сохраняет shiftRate для manager_trading', () => {
  it('передаёт shiftRate в Employee.create при создании заведующей', async () => {
    let capturedData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        employee: {
          create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            capturedData = data;
            return Promise.resolve({ id: 5 });
          }),
        },
        user: {
          create: vi.fn().mockResolvedValue({ id: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 1, username: 'aliya', displayName: 'Алия', isActive: true, employeeId: 5,
            pharmacies: [],
          }),
        },
        userPharmacy: { createMany: vi.fn() },
        employeePharmacy: { createMany: vi.fn() },
      })
    );

    await POST(makePostRequest({
      displayName: 'Алия', username: 'aliya', password: 'secret1',
      employeeType: 'manager_trading', baseSalary: 150000,
      fiveDayViaAttendance: true, shiftRate: 12000,
    }));

    expect(capturedData?.shiftRate).toBe('12000');
  });

  it('не сохраняет shiftRate для manager_fixed, даже если оно передано', async () => {
    let capturedData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        employee: {
          create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            capturedData = data;
            return Promise.resolve({ id: 6 });
          }),
        },
        user: {
          create: vi.fn().mockResolvedValue({ id: 2 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 2, username: 'olzhas', displayName: 'Олжас', isActive: true, employeeId: 6,
            pharmacies: [],
          }),
        },
        userPharmacy: { createMany: vi.fn() },
        employeePharmacy: { createMany: vi.fn() },
      })
    );

    await POST(makePostRequest({
      displayName: 'Олжас', username: 'olzhas', password: 'secret1',
      employeeType: 'manager_fixed', baseSalary: 150000, shiftRate: 12000,
    }));

    expect(capturedData?.shiftRate).toBeNull();
  });
});

describe('PUT /api/users/[id] — обновляет shiftRate для существующей заведующей', () => {
  it('записывает новую ставку в Employee.update', async () => {
    let capturedData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          update: vi.fn().mockResolvedValue({ id: 1, employeeId: 5 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 1, username: 'aliya', displayName: 'Алия', isActive: true, employeeId: 5,
            pharmacies: [],
          }),
        },
        employee: {
          update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            capturedData = data;
            return Promise.resolve({});
          }),
        },
        userPharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
        employeePharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
      })
    );

    await PUT(
      makePutRequest('http://localhost/api/users/1', { shiftRate: 13500 }),
      makeParams(1)
    );

    expect(capturedData?.shiftRate).toBe('13500');
  });

  it('снимает ставку, когда shiftRate передан как null', async () => {
    let capturedData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          update: vi.fn().mockResolvedValue({ id: 1, employeeId: 5 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 1, username: 'aliya', displayName: 'Алия', isActive: true, employeeId: 5,
            pharmacies: [],
          }),
        },
        employee: {
          update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            capturedData = data;
            return Promise.resolve({});
          }),
        },
        userPharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
        employeePharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
      })
    );

    await PUT(
      makePutRequest('http://localhost/api/users/1', { shiftRate: null }),
      makeParams(1)
    );

    expect(capturedData?.shiftRate).toBeNull();
  });

  it('не трогает shiftRate, если поле вообще не передано в запросе', async () => {
    let capturedData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: {
          update: vi.fn().mockResolvedValue({ id: 1, employeeId: 5 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 1, username: 'aliya', displayName: 'Алия', isActive: true, employeeId: 5,
            pharmacies: [],
          }),
        },
        employee: {
          update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            capturedData = data;
            return Promise.resolve({});
          }),
        },
        userPharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
        employeePharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
      })
    );

    await PUT(
      makePutRequest('http://localhost/api/users/1', { displayName: 'Алия Б.' }),
      makeParams(1)
    );

    expect(capturedData).not.toHaveProperty('shiftRate');
  });
});
