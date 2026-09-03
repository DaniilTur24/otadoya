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
    employee: {
      findMany: vi.fn(),
    },
    userPharmacy: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/employees/route';

const findManyEmployees = prisma.employee.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyUserPharmacy = prisma.userPharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeRequest(url: string, opts: { role?: string; userId?: number } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.role) headers['x-user-role'] = opts.role;
  if (opts.userId) headers['x-user-id'] = String(opts.userId);
  return new Request(url, { headers }) as unknown as NextRequest;
}

beforeEach(() => {
  findManyEmployees.mockReset();
  findManyUserPharmacy.mockReset();
  findUniqueUser.mockReset();
  findManyEmployees.mockResolvedValue([]);
  findUniqueUser.mockResolvedValue({ isActive: true });
});

describe('GET /api/employees — фильтрация по аптеке для заведующего', () => {
  it('заведующий с несколькими аптеками: запрос с pharmacyId фильтрует только по этой аптеке', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }, { pharmacyId: 2 }]);

    const res = await GET(makeRequest('http://localhost/api/employees?isActive=true&pharmacyId=2', { role: 'manager', userId: 5 }));

    expect((res as { status: number }).status).toBe(200);
    const where = findManyEmployees.mock.calls[findManyEmployees.mock.calls.length - 1][0].where;
    expect(where.pharmacies).toEqual({ some: { pharmacyId: 2 } });
  });

  it('заведующий не может запросить сотрудников чужой аптеки — 403', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }, { pharmacyId: 2 }]);

    const res = await GET(makeRequest('http://localhost/api/employees?isActive=true&pharmacyId=99', { role: 'manager', userId: 5 })) as { status: number };

    expect(res.status).toBe(403);
    expect(findManyEmployees).not.toHaveBeenCalled();
  });

  it('заведующий без pharmacyId в запросе видит сотрудников всех своих аптек', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }, { pharmacyId: 2 }]);

    await GET(makeRequest('http://localhost/api/employees?isActive=true', { role: 'manager', userId: 5 }));

    const where = findManyEmployees.mock.calls[findManyEmployees.mock.calls.length - 1][0].where;
    expect(where.pharmacies).toEqual({ some: { pharmacyId: { in: [1, 2] } } });
  });
});

// Regression: GET /api/employees отдаёт заведующему полный объект сотрудника, включая оклад,
// доплату, ставку и премиальные переключатели — заведующий видит финансовые данные коллег,
// хотя расчёт зарплаты (сколько кто заработал) для него отдельно закрыт. Найдено в QA-аудите
// (round 2, №8).
describe('GET /api/employees — финансовые поля скрыты от заведующего', () => {
  const RAW_EMPLOYEE = {
    id: 1,
    name: 'Иванова',
    employeeType: 'seller',
    baseSalary: '150000',
    allowance: '10000',
    allowanceDescription: 'за стаж',
    shiftRate: null,
    ladderPremiumEnabled: true,
    managerBonusShareEnabled: true,
    isActive: true,
    pharmacies: [{ pharmacy: { id: 2, name: 'Аптека 2' } }],
  };

  it('заведующий не получает оклад/доплату/ставку/премиальные переключатели', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 2 }]);
    findManyEmployees.mockResolvedValue([RAW_EMPLOYEE]);

    const res = await GET(makeRequest('http://localhost/api/employees', { role: 'manager', userId: 5 })) as unknown as {
      status: number;
      body: Record<string, unknown>[];
    };

    expect(res.status).toBe(200);
    const emp = res.body[0];
    expect(emp).not.toHaveProperty('baseSalary');
    expect(emp).not.toHaveProperty('allowance');
    expect(emp).not.toHaveProperty('allowanceDescription');
    expect(emp).not.toHaveProperty('shiftRate');
    expect(emp).not.toHaveProperty('ladderPremiumEnabled');
    expect(emp).not.toHaveProperty('managerBonusShareEnabled');
    // Рабочие поля для выбора сотрудника остаются
    expect(emp.name).toBe('Иванова');
    expect(emp.employeeType).toBe('seller');
  });

  it('админ по-прежнему получает полный объект', async () => {
    findManyEmployees.mockResolvedValue([RAW_EMPLOYEE]);

    const res = await GET(makeRequest('http://localhost/api/employees', { role: 'admin' })) as unknown as {
      status: number;
      body: Record<string, unknown>[];
    };

    expect(res.status).toBe(200);
    expect(res.body[0].baseSalary).toBe(150000);
    expect(res.body[0].allowance).toBe(10000);
  });

  it('бухгалтер тоже получает полный объект', async () => {
    findManyEmployees.mockResolvedValue([RAW_EMPLOYEE]);

    const res = await GET(makeRequest('http://localhost/api/employees', { role: 'bookkeeper' })) as unknown as {
      status: number;
      body: Record<string, unknown>[];
    };

    expect(res.status).toBe(200);
    expect(res.body[0].baseSalary).toBe(150000);
  });
});
