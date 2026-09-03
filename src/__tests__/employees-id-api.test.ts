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
    employee: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    attendanceShift: { count: vi.fn() },
    dailyRevenueEntry: { count: vi.fn() },
    dailyExpenseItem: { count: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { PUT, DELETE } from '@/app/api/employees/[id]/route';

const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateEmployee = prisma.employee.update as unknown as ReturnType<typeof vi.fn>;
const deleteEmployee = prisma.employee.delete as unknown as ReturnType<typeof vi.fn>;
const countAttendance = prisma.attendanceShift.count as unknown as ReturnType<typeof vi.fn>;
const countRevenueEntry = prisma.dailyRevenueEntry.count as unknown as ReturnType<typeof vi.fn>;
const countExpenseItem = prisma.dailyExpenseItem.count as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/employees/1', {
    method: 'PUT',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeDeleteRequest(): NextRequest {
  return new Request('http://localhost/api/employees/1', {
    method: 'DELETE',
    headers: { 'x-user-role': 'admin' },
  }) as unknown as NextRequest;
}

function makeParams(id = 1) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeEach(() => {
  findUniqueEmployee.mockReset();
  updateEmployee.mockReset().mockResolvedValue({ id: 1, pharmacies: [] });
  deleteEmployee.mockReset().mockResolvedValue({ id: 1 });
  // По умолчанию — без истории, чтобы существующие тесты на реальное удаление продолжали работать
  countAttendance.mockReset().mockResolvedValue(0);
  countRevenueEntry.mockReset().mockResolvedValue(0);
  countExpenseItem.mockReset().mockResolvedValue(0);
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

describe('DELETE /api/employees/[id] — заведующих/менеджеров можно удалить только на /users', () => {
  it.each(['manager_trading', 'manager_fixed', 'pharmacy_manager'])(
    'отклоняет удаление %s — нужно удалять на /users',
    async (employeeType) => {
      findUniqueEmployee.mockResolvedValue({ employeeType });

      const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as {
        status: number;
        body: { error: string };
      };

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/\/users/);
      expect(deleteEmployee).not.toHaveBeenCalled();
    }
  );

  it('разрешает удалить обычного seller', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });

    const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('разрешает удалить уборщицу и офисного сотрудника', async () => {
    for (const employeeType of ['cleaner', 'office']) {
      deleteEmployee.mockClear();
      findUniqueEmployee.mockResolvedValue({ employeeType });

      const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as { status: number };

      expect(res.status).toBe(200);
      expect(deleteEmployee).toHaveBeenCalled();
    }
  });
});

// Regression: жёсткое удаление каскадом стирает весь табель (AttendanceShift.onDelete:
// Cascade) и рвёт связь выданных авансов с получателем (DailyExpenseItem.employeeId.onDelete:
// SetNull) — деньги остаются расходом аптеки, но перестают вычитаться из чьей-либо зарплаты.
// Найдено в QA-аудите (round 2, №3): для сотрудника с историей удаление должно быть
// деактивацией, а не физическим удалением строки.
describe('DELETE /api/employees/[id] — сотрудника с историей деактивируют, а не удаляют', () => {
  it('деактивирует вместо удаления, если есть отметки табеля', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'cleaner' });
    countAttendance.mockResolvedValue(3);

    const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as {
      status: number;
      body: { ok: boolean; deactivated: boolean };
    };

    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(true);
    expect(deleteEmployee).not.toHaveBeenCalled();
    expect(updateEmployee).toHaveBeenCalledWith({ where: { id: 1 }, data: { isActive: false } });
  });

  it('деактивирует вместо удаления, если есть смены выручки', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });
    countRevenueEntry.mockResolvedValue(1);

    const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).not.toHaveBeenCalled();
    expect(updateEmployee).toHaveBeenCalledWith({ where: { id: 1 }, data: { isActive: false } });
  });

  it('деактивирует вместо удаления, если на сотрудника оформлены авансы/доплаты', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'office' });
    countExpenseItem.mockResolvedValue(2);

    const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).not.toHaveBeenCalled();
    expect(updateEmployee).toHaveBeenCalledWith({ where: { id: 1 }, data: { isActive: false } });
  });

  it('удаляет по-настоящему, если истории нет вообще', async () => {
    findUniqueEmployee.mockResolvedValue({ employeeType: 'seller' });

    const res = await DELETE(makeDeleteRequest(), makeParams(1)) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(deleteEmployee).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(updateEmployee).not.toHaveBeenCalled();
  });
});
