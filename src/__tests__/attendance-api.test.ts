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
    userPharmacy: { findMany: vi.fn() },
    attendanceShift: { create: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/attendance/route';

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const createShift = prisma.attendanceShift.create as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/attendance', {
    method: 'POST',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  findUniqueEmployee.mockReset();
  createShift.mockReset().mockResolvedValue({ id: 1 });
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

  it.each(['manager_fixed', 'cleaner', 'office', 'pharmacy_manager'])('разрешает отметку табеля для %s', async (employeeType) => {
    findUniqueEmployee.mockResolvedValue({ employeeType });

    const res = await POST(
      makeRequest({ employeeId: 28, date: '2026-06-26' })
    ) as unknown as { status: number };

    expect(res.status).toBe(201);
  });
});
