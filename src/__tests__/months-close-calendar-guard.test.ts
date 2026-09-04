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
    closedMonth: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/monthly-report-builder', () => ({
  computeMonthlyData: vi.fn().mockResolvedValue({ pharmacies: [], systemData: {}, overrideMap: {} }),
  buildMonthlySnapshot: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/salary-snapshot', () => ({
  buildEmployeeSalarySnapshot: vi.fn(),
  serializeSnapshot: vi.fn().mockReturnValue('{}'),
}));

import { prisma } from '@/lib/prisma';
import { buildEmployeeSalarySnapshot } from '@/lib/salary-snapshot';
import { POST } from '@/app/api/months/close/route';

const findUniqueClosedMonth = prisma.closedMonth.findUnique as unknown as ReturnType<typeof vi.fn>;
const createClosedMonth = prisma.closedMonth.create as unknown as ReturnType<typeof vi.fn>;
const buildSnapshot = buildEmployeeSalarySnapshot as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/months/close', {
    method: 'POST',
    headers: { 'x-user-role': 'admin', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  findUniqueClosedMonth.mockReset().mockResolvedValue(null);
  createClosedMonth.mockReset().mockResolvedValue({ closedAt: new Date('2026-10-01') });
  buildSnapshot.mockReset();
});

describe('POST /api/months/close — блокировка без производственного календаря', () => {
  it('отклоняет закрытие месяца, если хотя бы у одного сотрудника calendarMissing = true', async () => {
    buildSnapshot.mockResolvedValue([
      { employeeId: 1, employeeName: 'Уборщица Света', pharmacyId: null, calendarMissing: true },
      { employeeId: 1, employeeName: 'Уборщица Света', pharmacyId: 3, calendarMissing: true },
      { employeeId: 2, employeeName: 'Продавец Аян', pharmacyId: null, calendarMissing: false },
    ]);

    const res = await POST(makeRequest({ year: 2026, month: 9 })) as unknown as { status: number; body: { error: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/производственный календарь/);
    expect(res.body.error).toMatch(/Уборщица Света/);
    // Продавец Аян не задет — не должен попасть в список.
    expect(res.body.error).not.toMatch(/Продавец Аян/);
    expect(createClosedMonth).not.toHaveBeenCalled();
  });

  it('не считает дважды одного сотрудника — сообщение перечисляет имя один раз', async () => {
    buildSnapshot.mockResolvedValue([
      { employeeId: 1, employeeName: 'Менеджер Олжас', pharmacyId: null, calendarMissing: true },
      { employeeId: 1, employeeName: 'Менеджер Олжас', pharmacyId: 5, calendarMissing: true },
      { employeeId: 1, employeeName: 'Менеджер Олжас', pharmacyId: 6, calendarMissing: true },
    ]);

    const res = await POST(makeRequest({ year: 2026, month: 9 })) as unknown as { status: number; body: { error: string } };

    const occurrences = (res.body.error.match(/Менеджер Олжас/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('проверяет только общий расчёт по сотруднику (pharmacyId: null), не трогая разрезы по аптекам', async () => {
    // Производственный календарь общий на всю систему (не по аптекам), а отметок в общем
    // расчёте не меньше, чем в любом разрезе по конкретной аптеке — поэтому calendarMissing
    // в общем расчёте достаточно как единственной проверки: если он false, ни один разрез
    // по аптеке не мог набрать отметок сверх того, что уже учтено в общем.
    buildSnapshot.mockResolvedValue([
      { employeeId: 1, employeeName: 'Заведующая Гульнара', pharmacyId: null, calendarMissing: false },
      { employeeId: 1, employeeName: 'Заведующая Гульнара', pharmacyId: 7, calendarMissing: false },
      // Другой сотрудник тем временем реально пойман по общему расчёту.
      { employeeId: 2, employeeName: 'Менеджер Тимур', pharmacyId: null, calendarMissing: true },
    ]);

    const res = await POST(makeRequest({ year: 2026, month: 9 })) as unknown as { status: number; body: { error?: string } };

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Менеджер Тимур/);
    expect(res.body.error).not.toMatch(/Гульнара/);
    expect(createClosedMonth).not.toHaveBeenCalled();
  });

  it('закрывает месяц как обычно, когда календарь заполнен для всех', async () => {
    buildSnapshot.mockResolvedValue([
      { employeeId: 1, employeeName: 'Продавец Аян', pharmacyId: null, calendarMissing: false },
    ]);

    const res = await POST(makeRequest({ year: 2026, month: 9 })) as unknown as { status: number; body: { ok: boolean } };

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(createClosedMonth).toHaveBeenCalledTimes(1);
  });

  it('закрывает месяц как обычно, если у сотрудников вообще нет записей за месяц (пустой снимок)', async () => {
    buildSnapshot.mockResolvedValue([]);

    const res = await POST(makeRequest({ year: 2026, month: 9 })) as unknown as { status: number };

    expect(res.status).toBe(200);
    expect(createClosedMonth).toHaveBeenCalled();
  });
});
