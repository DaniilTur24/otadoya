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

const COUNTERS = [
  'dailyRevenueEntry', 'attendanceShift', 'extractedExpenseEntry', 'importedReportValue',
  'pharmacyPdfReport', 'monthlyReportOverride', 'employeePharmacy', 'userPharmacy', 'uploadedFile',
] as const;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pharmacy: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    dailyRevenueEntry: { count: vi.fn() },
    attendanceShift: { count: vi.fn() },
    extractedExpenseEntry: { count: vi.fn() },
    importedReportValue: { count: vi.fn() },
    pharmacyPdfReport: { count: vi.fn() },
    monthlyReportOverride: { count: vi.fn() },
    employeePharmacy: { count: vi.fn() },
    userPharmacy: { count: vi.fn() },
    uploadedFile: { count: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { DELETE } from '@/app/api/pharmacies/[id]/route';

type Mock = ReturnType<typeof vi.fn>;
const findUnique = prisma.pharmacy.findUnique as unknown as Mock;
const update = prisma.pharmacy.update as unknown as Mock;
const del = prisma.pharmacy.delete as unknown as Mock;
const counter = (name: (typeof COUNTERS)[number]) =>
  (prisma as unknown as Record<string, { count: Mock }>)[name].count;

function makeRequest(role = 'admin'): NextRequest {
  return new Request('http://localhost/api/pharmacies/3', { method: 'DELETE', headers: { 'x-user-role': role } }) as unknown as NextRequest;
}
const makeParams = (id = 3) => ({ params: Promise.resolve({ id: String(id) }) });

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ id: 3 });
  update.mockReset().mockResolvedValue({ id: 3, isActive: false });
  del.mockReset().mockResolvedValue({ id: 3 });
  for (const c of COUNTERS) counter(c).mockReset().mockResolvedValue(0);
});

// QA раунд 3 №8 / раунд 4 №18: удаление без проверок — при записях выручки 500, а PDF-отчёты,
// правки отчёта, привязки, табель и импорт стирались каскадом молча. Теперь с историей — деактивация.
describe('DELETE /api/pharmacies/[id]', () => {
  it('удаляет аптеку без истории', async () => {
    const res = await DELETE(makeRequest(), makeParams()) as unknown as { status: number; body: { deactivated?: boolean } };
    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBeUndefined();
    expect(del).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(update).not.toHaveBeenCalled();
  });

  it.each(COUNTERS)('деактивирует, а не удаляет, если есть %s', async (name) => {
    counter(name).mockResolvedValue(1);
    const res = await DELETE(makeRequest(), makeParams()) as unknown as { status: number; body: { deactivated?: boolean; message?: string } };
    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(true);
    expect(res.body.message).toMatch(/деактивирована/);
    expect(update).toHaveBeenCalledWith({ where: { id: 3 }, data: { isActive: false } });
    expect(del).not.toHaveBeenCalled();
  });

  it('404, если аптеки нет', async () => {
    findUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), makeParams(99)) as unknown as { status: number };
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });

  it('бухгалтеру недоступно (403)', async () => {
    const res = await DELETE(makeRequest('bookkeeper'), makeParams()) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
});
