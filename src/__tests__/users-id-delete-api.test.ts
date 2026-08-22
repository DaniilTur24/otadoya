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
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { DELETE } from '@/app/api/users/[id]/route';

const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/users/1', {
    method: 'DELETE',
    headers: { 'x-user-role': 'admin' },
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function mockTx(employeeId: number | null) {
  const deleteEmployee = vi.fn().mockResolvedValue({ id: employeeId });
  const deleteUser = vi.fn().mockResolvedValue({ id: 1 });
  const findUniqueUser = vi.fn().mockResolvedValue({ employeeId });
  transaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      user: { findUnique: findUniqueUser, delete: deleteUser },
      employee: { delete: deleteEmployee },
    })
  );
  return { deleteEmployee, deleteUser, findUniqueUser };
}

describe('DELETE /api/users/[id] — удаление аккаунта убирает и привязанную карточку сотрудника', () => {
  it('удаляет и Employee, и User, когда аккаунт привязан к карточке', async () => {
    const { deleteEmployee, deleteUser } = mockTx(7);

    const res = await DELETE(makeRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('не пытается удалить Employee, если у аккаунта нет привязанной карточки', async () => {
    const { deleteEmployee, deleteUser } = mockTx(null);

    const res = await DELETE(makeRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
