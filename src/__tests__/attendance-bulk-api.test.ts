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
    attendanceShift: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    dailyRevenueEntry: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    closedMonth: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { PUT } from '@/app/api/attendance/bulk/route';

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const findManyShifts = prisma.attendanceShift.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyUserPharmacy = prisma.userPharmacy.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;
const findManyRevenueEntries = prisma.dailyRevenueEntry.findMany as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown, opts: { role?: string; userId?: number } = {}): NextRequest {
  return new Request('http://localhost/api/attendance/bulk', {
    method: 'PUT',
    headers: {
      'x-user-role': opts.role ?? 'admin',
      ...(opts.userId ? { 'x-user-id': String(opts.userId) } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  findUniqueEmployee.mockReset().mockResolvedValue({ id: 28, employeeType: 'manager_fixed' });
  findManyShifts.mockReset().mockResolvedValue([]);
  findManyUserPharmacy.mockReset().mockResolvedValue([]);
  findUniqueUser.mockReset().mockResolvedValue({ isActive: true });
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  findManyRevenueEntries.mockReset().mockResolvedValue([]);
  transaction.mockReset().mockResolvedValue([]);
});

// Массовая реконсиляция переписывает весь месяц целиком, включая удаление отметок —
// в закрытом месяце это разошлось бы с зафиксированной зарплатой.
describe('PUT /api/attendance/bulk — запрет записи в закрытый месяц', () => {
  it('отклоняет массовое обновление закрытого месяца с 423', async () => {
    findUniqueClosedMonth.mockResolvedValue({ id: 1, year: 2026, month: 6 });

    const res = await PUT(
      makeRequest({ employeeId: 28, year: 2026, month: 6, dates: ['2026-06-01'] })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/Месяц закрыт/);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('PUT /api/attendance/bulk', () => {
  it('отклоняет сменные типы сотрудников', async () => {
    findUniqueEmployee.mockResolvedValue({ id: 19, employeeType: 'seller' });

    const res = await PUT(
      makeRequest({ employeeId: 19, year: 2026, month: 6, dates: ['2026-06-01'] })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/смену в записи выручки/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('отклоняет дату вне выбранного месяца', async () => {
    const res = await PUT(
      makeRequest({ employeeId: 28, year: 2026, month: 6, dates: ['2026-07-01'] })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/вне выбранного месяца/);
  });

  it('создаёт отметки на новые даты и удаляет снятые', async () => {
    findManyShifts
      .mockResolvedValueOnce([
        { id: 1, date: new Date('2026-06-05'), pharmacyId: 2 },
        { id: 2, date: new Date('2026-06-06'), pharmacyId: 2 },
      ])
      .mockResolvedValueOnce([]);

    await PUT(
      makeRequest({ employeeId: 28, pharmacyId: 2, year: 2026, month: 6, dates: ['2026-06-05', '2026-06-07'] })
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    const ops = transaction.mock.calls[0][0];
    // удалить id=2 (06-06 снята) + создать/обновить 06-05 (тот же pharmacyId — пропускается) и 06-07 (новая)
    expect(ops.length).toBeGreaterThanOrEqual(2);
  });

  it('заведующий без доступа к аптеке получает 403', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 1 }]);

    const res = await PUT(
      makeRequest({ employeeId: 28, pharmacyId: 2, year: 2026, month: 6, dates: [] }, { role: 'manager', userId: 5 })
    ) as unknown as { status: number };

    expect(res.status).toBe(403);
  });

  it('заведующий со своей аптекой может массово обновить', async () => {
    findManyUserPharmacy.mockResolvedValue([{ pharmacyId: 2 }]);

    const res = await PUT(
      makeRequest(
        { employeeId: 28, pharmacyId: 2, year: 2026, month: 6, dates: ['2026-06-10'] },
        { role: 'manager', userId: 5 }
      )
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });
});

/**
 * Массовая реконсиляция приходит одним запросом на весь месяц, поэтому конфликтный день
 * нужно ловить по всему переданному набору дат сразу — иначе он проскочил бы и день
 * оплатился бы дважды: и сменой в записи выручки, и отметкой табеля.
 */
describe('PUT /api/attendance/bulk — запрет двойной оплаты одного дня', () => {
  it('отклоняет набор, если хотя бы на одну дату есть смена в записи выручки', async () => {
    findManyRevenueEntries.mockResolvedValue([{ date: new Date(2026, 5, 3) }]);

    const res = await PUT(
      makeRequest({ employeeId: 28, year: 2026, month: 6, dates: ['2026-06-02', '2026-06-03'] })
    ) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/уже есть смена/);
    expect(res.body.error).toContain('03.06.2026');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('пропускает набор, если смены попадают на другие дни месяца', async () => {
    findManyRevenueEntries.mockResolvedValue([{ date: new Date(2026, 5, 20) }]);

    const res = await PUT(
      makeRequest({ employeeId: 28, year: 2026, month: 6, dates: ['2026-06-02', '2026-06-03'] })
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalled();
  });

  it('снятие всех отметок не блокируется существующими сменами', async () => {
    findManyRevenueEntries.mockResolvedValue([{ date: new Date(2026, 5, 3) }]);

    const res = await PUT(
      makeRequest({ employeeId: 28, year: 2026, month: 6, dates: [] })
    ) as unknown as { status: number };

    expect(res.status).toBe(200);
  });
});
