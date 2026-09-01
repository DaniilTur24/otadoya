import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { employee: { findMany: vi.fn() } },
}));

vi.mock('@/lib/salary-calculator', () => ({
  calculateEmployeeMonthlySalary: vi.fn(),
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
      { id: 7, pharmacies: [{ pharmacyId: 1 }, { pharmacyId: 2 }] },
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
    mocked(prisma.employee.findMany).mockResolvedValue([{ id: 9, pharmacies: [] }]);
    mocked(calculateEmployeeMonthlySalary).mockResolvedValue(salary(9, 0));

    const stored = await buildEmployeeSalarySnapshot(2026, 8);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ employeeId: 9, pharmacyId: null, totalSalary: 0 });
  });

  it('берёт только активных сотрудников', async () => {
    mocked(prisma.employee.findMany).mockResolvedValue([]);
    await buildEmployeeSalarySnapshot(2026, 8);
    expect(mocked(prisma.employee.findMany).mock.calls.at(-1)![0].where).toEqual({ isActive: true });
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

/**
 * Снимки версии 2 сделаны до появления графика и второго оклада. Если читать их как есть,
 * карточка за закрытый месяц получит workSchedule = undefined и спрячет разом и смены,
 * и табель — поэтому недостающие поля выводятся при чтении.
 */
describe('parseSnapshot — снимки, сделанные до появления графика', () => {
  it('выводит график и второй оклад для записей без этих полей', () => {
    const legacy = JSON.stringify({
      version: 2,
      pharmacies: {},
      employees: [
        { employeeId: 1, employeeType: 'manager_fixed', baseSalary: 190000, pharmacyId: null },
        { employeeId: 2, employeeType: 'seller', baseSalary: 150000, pharmacyId: 3 },
      ],
    });

    const { employees } = parseSnapshot(legacy);
    expect(employees[0].workSchedule).toBe('five_day');
    expect(employees[0].fiveDaySalary).toBe(190000);
    expect(employees[1].workSchedule).toBe('shift');
    expect(employees[1].fiveDaySalary).toBe(150000);
  });

  it('не трогает записи, где график уже сохранён', () => {
    const current = JSON.stringify({
      version: 3,
      pharmacies: {},
      employees: [
        { employeeId: 1, employeeType: 'seller', baseSalary: 190000, workSchedule: 'mixed', fiveDaySalary: 260000, pharmacyId: null },
      ],
    });

    const { employees } = parseSnapshot(current);
    expect(employees[0].workSchedule).toBe('mixed');
    expect(employees[0].fiveDaySalary).toBe(260000);
  });
});
