import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { employee: { findMany: vi.fn() } },
}));

vi.mock('@/lib/salary-calculator', () => ({
  calculateEmployeeMonthlySalary: vi.fn(),
  hasMonthActivity: (r: { recordsCount?: number; totalAdvances?: number; totalSurcharges?: number; totalBonuses?: number }) =>
    (r.recordsCount ?? 0) > 0 || (r.totalAdvances ?? 0) > 0 || (r.totalSurcharges ?? 0) > 0 || (r.totalBonuses ?? 0) > 0,
}));

import { prisma } from '@/lib/prisma';
import { calculateEmployeeMonthlySalary } from '@/lib/salary-calculator';
import {
  buildEmployeeSalarySnapshot,
  serializeSnapshot,
  parseSnapshot,
  findStoredSalary,
  type StoredSalary,
} from '@/lib/salary-snapshot';

const mocked = (fn: unknown) => vi.mocked(fn as ReturnType<typeof vi.fn>);

function salary(employeeId: number, totalSalary: number) {
  return { employeeId, totalSalary } as unknown as StoredSalary;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildEmployeeSalarySnapshot', () => {
  it('сохраняет общий расчёт и расчёт по каждой привязанной аптеке', async () => {
    mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 7, isActive: true, pharmacies: [{ pharmacyId: 1 }, { pharmacyId: 2 }] },
    ]);
    mocked(calculateEmployeeMonthlySalary)
      .mockResolvedValueOnce(salary(7, 300))  // без фильтра по аптеке
      .mockResolvedValueOnce(salary(7, 100))  // аптека 1
      .mockResolvedValueOnce(salary(7, 200)); // аптека 2

    const stored = await buildEmployeeSalarySnapshot(2026, 8);

    expect(stored).toEqual([
      expect.objectContaining({ employeeId: 7, pharmacyId: null, totalSalary: 300 }),
      expect.objectContaining({ employeeId: 7, pharmacyId: 1, totalSalary: 100 }),
      expect.objectContaining({ employeeId: 7, pharmacyId: 2, totalSalary: 200 }),
    ]);
  });

  // calculateAllEmployeesSalaries отбрасывает сотрудников без записей, но снимок должен
  // отвечать на любой запрос — иначе такой сотрудник провалится в живой расчёт.
  it('включает сотрудника без записей за месяц', async () => {
    mocked(prisma.employee.findMany).mockResolvedValue([{ id: 9, isActive: true, pharmacies: [] }]);
    mocked(calculateEmployeeMonthlySalary).mockResolvedValue(salary(9, 0));

    const stored = await buildEmployeeSalarySnapshot(2026, 8);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ employeeId: 9, pharmacyId: null, totalSalary: 0 });
  });

  // QA раунд 4, №11: уволенный и деактивированный после 20-го продавец должен замереть в снимке
  // за месяц, в котором ещё работал; деактивированный без операций — не нужен.
  it('деактивированного сотрудника включает только при операциях в месяце', async () => {
    mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 11, isActive: false, pharmacies: [{ pharmacyId: 1 }] }, // работал: 20 смен
      { id: 12, isActive: false, pharmacies: [{ pharmacyId: 1 }] }, // давно уволен, пусто
    ]);
    mocked(calculateEmployeeMonthlySalary).mockImplementation(async (id: number) =>
      ({ employeeId: id, totalSalary: id === 11 ? 250 : 0, recordsCount: id === 11 ? 20 : 0 }) as unknown as StoredSalary
    );

    const stored = await buildEmployeeSalarySnapshot(2026, 8);

    expect(stored.map((s) => [s.employeeId, s.pharmacyId])).toEqual([[11, null], [11, 1]]);
  });

  it('запрашивает всех сотрудников, а не только активных', async () => {
    mocked(prisma.employee.findMany).mockResolvedValue([]);
    await buildEmployeeSalarySnapshot(2026, 8);
    expect(mocked(prisma.employee.findMany).mock.calls.at(-1)![0].where).toBeUndefined();
  });
});

describe('parseSnapshot', () => {
  it('читает новый формат с зарплатами', () => {
    const json = serializeSnapshot({ '1': { retailRevenue: 500 } }, [salary(7, 300)]);
    const parsed = parseSnapshot(json);

    expect(parsed.pharmacies).toEqual({ '1': { retailRevenue: 500 } });
    expect(parsed.employees).toHaveLength(1);
  });

  // Снимки, сделанные до появления зарплатной секции, — это сам объект аптек без обёртки.
  // Отчёт по ним должен продолжать работать, а карточка — считать вживую.
  it('читает старый формат без обёртки как аптеки с пустым списком зарплат', () => {
    const legacy = JSON.stringify({ '1': { retailRevenue: 500 }, '2': { retailRevenue: 700 } });
    const parsed = parseSnapshot(legacy);

    expect(parsed.pharmacies).toEqual({ '1': { retailRevenue: 500 }, '2': { retailRevenue: 700 } });
    expect(parsed.employees).toEqual([]);
  });
});

describe('findStoredSalary', () => {
  const employees = [
    { ...salary(7, 300), pharmacyId: null },
    { ...salary(7, 100), pharmacyId: 1 },
    { ...salary(9, 50), pharmacyId: null },
  ] as StoredSalary[];

  it('находит общий расчёт по null', () => {
    expect(findStoredSalary(employees, 7, null)?.totalSalary).toBe(300);
  });

  it('находит расчёт по конкретной аптеке', () => {
    expect(findStoredSalary(employees, 7, 1)?.totalSalary).toBe(100);
  });

  // Общий расчёт и расчёт по аптеке — разные суммы; подмена одного другим показала бы
  // бухгалтеру чужое число под видом зафиксированного.
  it('не подменяет расчёт по аптеке общим, если его нет в снимке', () => {
    expect(findStoredSalary(employees, 9, 1)).toBeNull();
    expect(findStoredSalary(employees, 7, 2)).toBeNull();
  });

  it('возвращает null для сотрудника, которого нет в снимке', () => {
    expect(findStoredSalary(employees, 404, null)).toBeNull();
  });
});
