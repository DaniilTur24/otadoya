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
    employeePharmacy: { findMany: vi.fn() },
    dailyRevenueEntry: { count: vi.fn() },
    attendanceShift: { count: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    userPharmacy: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { PUT as putEmployeePharmacies } from '@/app/api/employees/[id]/pharmacies/route';
import { PUT as putUser } from '@/app/api/users/[id]/route';

const findManyEmployeePharmacy = prisma.employeePharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const countRevenue = prisma.dailyRevenueEntry.count as unknown as ReturnType<typeof vi.fn>;
const countAttendance = prisma.attendanceShift.count as unknown as ReturnType<typeof vi.fn>;
const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  findManyEmployeePharmacy.mockReset().mockResolvedValue([{ pharmacyId: 1 }, { pharmacyId: 2 }]);
  countRevenue.mockReset().mockResolvedValue(0);
  countAttendance.mockReset().mockResolvedValue(0);
  findUniqueUser.mockReset().mockResolvedValue({ employeeId: 7 });
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    typeof cb === 'function'
      ? cb({
          user: {
            update: vi.fn().mockResolvedValue({ id: 1, employeeId: 7 }),
            findUnique: vi.fn().mockResolvedValue({ id: 1, employeeId: 7, pharmacies: [] }),
          },
          employee: { update: vi.fn() },
          userPharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
          employeePharmacy: { deleteMany: vi.fn(), createMany: vi.fn() },
        })
      : Promise.resolve([])
  );
});

describe('PUT /api/employees/[id]/pharmacies — блокировка отвязки при наличии данных', () => {
  it('блокирует отвязку аптеки, если есть записи выручки по ней', async () => {
    countRevenue.mockResolvedValue(3);

    const res = await putEmployeePharmacies(
      makeRequest('http://localhost/api/employees/7/pharmacies', { pharmacyIds: [1] }),
      makeParams(7)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Нельзя отвязать/);
  });

  it('блокирует отвязку аптеки, если есть отметки табеля по ней', async () => {
    countAttendance.mockResolvedValue(2);

    const res = await putEmployeePharmacies(
      makeRequest('http://localhost/api/employees/7/pharmacies', { pharmacyIds: [1] }),
      makeParams(7)
    ) as unknown as { status: number };

    expect(res.status).toBe(409);
  });

  it('разрешает отвязку аптеки без данных', async () => {
    const res = await putEmployeePharmacies(
      makeRequest('http://localhost/api/employees/7/pharmacies', { pharmacyIds: [1] }),
      makeParams(7)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });

  it('не проверяет аптеки, которые остаются привязанными', async () => {
    const res = await putEmployeePharmacies(
      makeRequest('http://localhost/api/employees/7/pharmacies', { pharmacyIds: [1, 2] }),
      makeParams(7)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(countRevenue).not.toHaveBeenCalled();
  });
});

describe('PUT /api/users/[id] — блокировка отвязки связанного сотрудника от аптеки', () => {
  it('блокирует отвязку аптеки заведующего, если есть незакрытые данные', async () => {
    countAttendance.mockResolvedValue(1);

    const res = await putUser(
      makeRequest('http://localhost/api/users/1', { pharmacyIds: [1] }),
      makeParams(1)
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Нельзя отвязать/);
  });

  it('разрешает менять список аптек без данных по убираемой', async () => {
    const res = await putUser(
      makeRequest('http://localhost/api/users/1', { pharmacyIds: [1] }),
      makeParams(1)
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });
});
