import { describe, it, expect, vi } from 'vitest';
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
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    attendanceShift: { count: vi.fn() },
    dailyRevenueEntry: { count: vi.fn() },
    dailyExpenseItem: { count: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { DELETE } from '@/app/api/users/[id]/route';

type Mock = ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as Mock;
const findUniqueUser = prisma.user.findUnique as unknown as Mock;
const attendanceCount = prisma.attendanceShift.count as unknown as Mock;
const revenueCount = prisma.dailyRevenueEntry.count as unknown as Mock;
const expenseItemCount = prisma.dailyExpenseItem.count as unknown as Mock;

function makeRequest(role = 'admin'): NextRequest {
  return new Request('http://localhost/api/users/1', {
    method: 'DELETE',
    headers: { 'x-user-role': role },
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function mockHistory({ attendance = 0, revenue = 0, expenseItems = 0 } = {}) {
  attendanceCount.mockResolvedValue(attendance);
  revenueCount.mockResolvedValue(revenue);
  expenseItemCount.mockResolvedValue(expenseItems);
}

function mockTx(employeeId: number | null) {
  findUniqueUser.mockResolvedValue({ employeeId });
  const deleteEmployee = vi.fn().mockResolvedValue({ id: employeeId });
  const deleteUser = vi.fn().mockResolvedValue({ id: 1 });
  const updateEmployee = vi.fn().mockResolvedValue({ id: employeeId, isActive: false });
  const updateUser = vi.fn().mockResolvedValue({ id: 1, isActive: false });
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      user: { delete: deleteUser, update: updateUser },
      employee: { delete: deleteEmployee, update: updateEmployee },
    })
  );
  return { deleteEmployee, deleteUser, updateEmployee, updateUser };
}

describe('DELETE /api/users/[id] — удаление аккаунта убирает и привязанную карточку сотрудника', () => {
  it('удаляет и Employee, и User, когда аккаунт привязан к карточке без истории', async () => {
    mockHistory();
    const { deleteEmployee, deleteUser, updateEmployee } = mockTx(7);

    const res = await DELETE(makeRequest(), makeParams(1)) as unknown as { status: number; body: { deactivated?: boolean } };

    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBeUndefined();
    expect(deleteEmployee).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it('не пытается удалить Employee, если у аккаунта нет привязанной карточки', async () => {
    mockHistory();
    const { deleteEmployee, deleteUser } = mockTx(null);

    const res = await DELETE(makeRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('возвращает 404, если аккаунта нет', async () => {
    findUniqueUser.mockResolvedValue(null);

    const res = await DELETE(makeRequest(), makeParams(99)) as unknown as { status: number };

    expect(res.status).toBe(404);
  });
});

// Жёсткое удаление Employee каскадом стирает табель (AttendanceShift.onDelete: Cascade) и
// отвязывает выданные авансы/доплаты (DailyExpenseItem.employeeId → SetNull): деньги, реально
// выданные из кассы, переставали вычитаться из чьей-либо зарплаты и пропадали из отчётов.
// Та же защита, что в DELETE /api/employees/[id]: с историей — деактивация, не удаление.
describe('DELETE /api/users/[id] — с историей деактивирует, а не удаляет (QA раунд 4, №1)', () => {
  it.each([
    ['табель', { attendance: 3 }],
    ['смены выручки', { revenue: 2 }],
    ['авансы/доплаты на его имя', { expenseItems: 1 }],
  ])('деактивирует аккаунт и карточку, если есть %s', async (_label, history) => {
    mockHistory(history);
    const { deleteEmployee, deleteUser, updateEmployee, updateUser } = mockTx(7);

    const res = await DELETE(makeRequest(), makeParams(1)) as unknown as {
      status: number;
      body: { ok: boolean; deactivated?: boolean; message?: string };
    };

    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(true);
    expect(res.body.message).toMatch(/деактивирован/);
    expect(updateEmployee).toHaveBeenCalledWith({ where: { id: 7 }, data: { isActive: false } });
    expect(updateUser).toHaveBeenCalledWith({ where: { id: 1 }, data: { isActive: false } });
    expect(deleteEmployee).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('проверяет историю именно привязанной карточки (employeeId), а не id аккаунта', async () => {
    mockHistory({ attendance: 1 });
    mockTx(42);

    await DELETE(makeRequest(), makeParams(1));

    const lastCall = attendanceCount.mock.calls[attendanceCount.mock.calls.length - 1][0];
    expect(lastCall).toEqual({ where: { employeeId: 42 } });
  });

  it('бухгалтер тоже получает деактивацию, а не жёсткое удаление', async () => {
    mockHistory({ expenseItems: 2 });
    const { deleteEmployee, updateEmployee } = mockTx(7);

    const res = await DELETE(makeRequest('bookkeeper'), makeParams(1)) as unknown as { status: number; body: { deactivated?: boolean } };

    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(true);
    expect(updateEmployee).toHaveBeenCalled();
    expect(deleteEmployee).not.toHaveBeenCalled();
  });
});
