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
    employee: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/employees/[id]/route';

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateEmployee = prisma.employee.update as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/employees/1', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  findUniqueEmployee.mockReset();
  updateEmployee.mockReset().mockResolvedValue({ id: 1, pharmacies: [] });
});

describe('PUT /api/employees/[id] — защита USER_LINKED_TYPES от редактирования вне /users', () => {
  it.each(['manager_trading', 'manager_fixed', 'pharmacy_manager'])(
    'отклоняет смену оклада для %s — нужно менять на /users',
    async (employeeType) => {
      findUniqueEmployee.mockResolvedValue({ employeeType });

      const res = await PUT(makeRequest({ baseSalary: 999999 }), makeParams(1)) as unknown as {
        status: number;
        body: { error: string };
      };

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/\/users/);
      expect(updateEmployee).not.toHaveBeenCalled();
    }
  );

  it('отклоняет смену employeeType для manager_fixed', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_fixed' });

    const res = await PUT(makeRequest({ employeeType: 'seller' }), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('отклоняет смену доплаты (allowance) для pharmacy_manager', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'pharmacy_manager' });

    const res = await PUT(makeRequest({ allowance: 50000 }), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('разрешает деактивацию (isActive) даже для manager_fixed', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'manager_fixed' });

    const res = await PUT(makeRequest({ isActive: false }), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(updateEmployee).toHaveBeenCalled();
  });

  it('разрешает менять оклад обычному seller', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });

    const res = await PUT(makeRequest({ baseSalary: 150000 }), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(updateEmployee).toHaveBeenCalled();
  });
});
