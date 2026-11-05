import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyRevenueEntry: { findUnique: vi.fn(), aggregate: vi.fn() },
    dailyExpenseItem: { findMany: vi.fn() },
    employee: { findUnique: vi.fn(), count: vi.fn() },
    pharmacy: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/salary-calculator', () => ({
  calculateEmployeeMonthlySalary: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { calculateEmployeeMonthlySalary } from '@/lib/salary-calculator';
import { computeRevenueDeleteImpact } from '@/lib/revenue-delete-impact';

const findUniqueEntry = prisma.dailyRevenueEntry.findUnique as unknown as ReturnType<typeof vi.fn>;
const aggregateEntry = prisma.dailyRevenueEntry.aggregate as unknown as ReturnType<typeof vi.fn>;
const findManyExpenseItem = prisma.dailyExpenseItem.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueEmployee = prisma.employee.findUnique as unknown as ReturnType<typeof vi.fn>;
const countEmployees = prisma.employee.count as unknown as ReturnType<typeof vi.fn>;
const findUniquePharmacy = prisma.pharmacy.findUnique as unknown as ReturnType<typeof vi.fn>;
const calcSalary = calculateEmployeeMonthlySalary as unknown as ReturnType<typeof vi.fn>;

const baseEntry = {
  id: 1,
  pharmacyId: 1,
  employeeId: 19,
  status: 'approved',
  excludedFromReport: false,
  date: new Date(2026, 5, 26), // 26.06.2026, локальное время — как startOfMonth/endOfMonth в этом модуле
  shiftType: 'day' as string | null,
  cashRevenue: '10000',
  terminalRevenue: '5000',
  kaspiRevenue: '0',
};

function ownerSalary(overrides: Partial<Record<string, number>> = {}) {
  return {
    totalSalary: 100000,
    // Без авансов и бонусов начисленное совпадает с итогом; тесты на округление задают их явно
    grossAccrued: overrides.totalSalary ?? 100000,
    totalBonuses: 0,
    totalAdvances: 0,
    baseSalary: 150000,
    dayShiftsCount: 2,
    fullDayShiftsCount: 0,
    salaryFromDayShifts: 20000,
    salaryFromFullDayShifts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  findUniqueEntry.mockReset().mockResolvedValue(baseEntry);
  aggregateEntry.mockReset().mockResolvedValue({
    _sum: { cashRevenue: '500000', terminalRevenue: '100000', kaspiRevenue: '0' },
  });
  findManyExpenseItem.mockReset().mockResolvedValue([]);
  findUniqueEmployee.mockReset().mockResolvedValue({ name: 'Etel' });
  countEmployees.mockReset().mockResolvedValue(0);
  findUniquePharmacy.mockReset().mockResolvedValue({ name: 'Тестовая аптека QA' });
  calcSalary.mockReset().mockResolvedValue(ownerSalary());
});

describe('computeRevenueDeleteImpact — базовые условия', () => {
  it('null, если запись не найдена', async () => {
    findUniqueEntry.mockResolvedValue(null);
    expect(await computeRevenueDeleteImpact(1)).toBeNull();
  });

  it('null, если запись ещё не подтверждена (pending)', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, status: 'pending' });
    expect(await computeRevenueDeleteImpact(1)).toBeNull();
  });

  it('null, если запись уже исключена из отчёта', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, excludedFromReport: true });
    expect(await computeRevenueDeleteImpact(1)).toBeNull();
  });
});

describe('computeRevenueDeleteImpact — выручка аптеки', () => {
  it('после = до минус выручка самой записи', async () => {
    const impact = await computeRevenueDeleteImpact(1);
    // до: 500000 + 100000 = 600000; запись: 10000 + 5000 = 15000
    expect(impact?.revenue).toEqual({ pharmacyName: 'Тестовая аптека QA', before: 600000, after: 585000 });
  });
});

describe('computeRevenueDeleteImpact — сменная оплата владельца записи', () => {
  it('day: пересчитывает весь округлённый итог с count-1, а не вычитает округлённую долю одной смены', async () => {
    // baseSalary=190000 специально не делится ровно на 15 (см. round-to-5 из QA раунда 3):
    // roundMoney(190000/15*2) = 25335, roundMoney(190000/15*1) = 12665. Если бы код вместо
    // пересчёта всего итога вычитал round(baseSalary/15) из salaryFromDayShifts, получилось бы
    // 25335-12665=12670 → итог 87335 — на 5 ₸ отличается от корректных 87330. Этот тест ловит
    // именно такой регресс (та же ловушка округления по кусочкам, что и в salary-calculator.ts).
    calcSalary.mockResolvedValue(ownerSalary({ baseSalary: 190000, dayShiftsCount: 2, salaryFromDayShifts: 25335, totalSalary: 100000 }));

    const impact = await computeRevenueDeleteImpact(1);

    const owner = impact?.employees.find((e) => e.employeeId === 19);
    expect(owner).toBeDefined();
    expect(owner?.before).toBe(100000);
    expect(owner?.after).toBe(87330);
    expect(impact?.partial).toBe(true);
  });

  it('full_day: считает по /10 и fullDayShiftsCount', async () => {
    calcSalary.mockResolvedValue(
      ownerSalary({ dayShiftsCount: 0, salaryFromDayShifts: 0, fullDayShiftsCount: 3, salaryFromFullDayShifts: 45000, totalSalary: 200000 })
    );
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: 'full_day' });

    const impact = await computeRevenueDeleteImpact(1);

    const owner = impact?.employees.find((e) => e.employeeId === 19);
    // baseSalary(150000)/10 * 3 = 45000; baseSalary/10 * 2 = 30000 → delta 15000
    expect(owner?.after).toBe(185000);
    expect(impact?.partial).toBe(true);
  });

  it('без shiftType (например, ручная запись без смены) — сменная часть не трогается, partial=false', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: null });
    calcSalary.mockResolvedValue(ownerSalary({ totalSalary: 100000 }));

    const impact = await computeRevenueDeleteImpact(1);

    const owner = impact?.employees.find((e) => e.employeeId === 19);
    expect(owner?.before).toBe(100000);
    expect(owner?.after).toBe(100000);
    expect(impact?.partial).toBe(false);
  });

  it('если у сотрудника не найден расчёт зарплаты (calculateEmployeeMonthlySalary → null) — владелец не попадает в employees', async () => {
    calcSalary.mockResolvedValue(null);

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.employees.find((e) => e.employeeId === 19)).toBeUndefined();
  });
});

describe('computeRevenueDeleteImpact — бонус самой записи', () => {
  const bonusItem = (amount: string) => ({ employeeId: null, category: 'pharmaBonus', amount, employee: null });

  it('запись без смены с бонусом 222: зарплата падает с 220 до 0, а не остаётся 220', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: null });
    findManyExpenseItem.mockResolvedValue([bonusItem('222')]);
    calcSalary.mockResolvedValue(ownerSalary({ totalSalary: 220, grossAccrued: 0, totalBonuses: 222 }));

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.employees).toEqual([{ employeeId: 19, employeeName: 'Etel', before: 220, after: 0 }]);
    expect(impact?.partial).toBe(false);
  });

  it('запись со сменой: вычитаются и оплата смены, и бонус', async () => {
    findManyExpenseItem.mockResolvedValue([bonusItem('3000'), bonusItem('2000')]);
    // Смены 20000 + прочее 80000 + бонусы 5000; без записи смена стоит 10000
    calcSalary.mockResolvedValue(ownerSalary({ totalSalary: 105000, grossAccrued: 100000, totalBonuses: 5000 }));

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.employees[0].after).toBe(90000); // 105000 − 10000 смена − 5000 бонус
  });

  it('у табельного сотрудника бонус не входит в зарплату: сумма не меняется', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: null });
    findManyExpenseItem.mockResolvedValue([bonusItem('5000')]);
    calcSalary.mockResolvedValue(ownerSalary({ totalSalary: 100000, totalBonuses: 0 }));

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.employees[0].after).toBe(100000);
  });

  it('если в аптеке есть заведующая с долей бонусов — оценка помечается неполной', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: null });
    findManyExpenseItem.mockResolvedValue([bonusItem('5000')]);
    countEmployees.mockResolvedValue(1);

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.partial).toBe(true);
    const where = countEmployees.mock.calls[countEmployees.mock.calls.length - 1][0].where;
    expect(where).toEqual({
      employeeType: { in: ['manager_trading', 'manager_fixed', 'pharmacy_manager'] },
      managerBonusShareEnabled: true,
      pharmacies: { some: { pharmacyId: 1 } },
    });
  });

  it('без бонуса в записи заведующих не ищет', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: null });

    const impact = await computeRevenueDeleteImpact(1);

    expect(countEmployees).not.toHaveBeenCalled();
    expect(impact?.partial).toBe(false);
  });

  it('бонус не показывается как выдача отдельному сотруднику', async () => {
    findUniqueEntry.mockResolvedValue({ ...baseEntry, employeeId: null, shiftType: null });
    findManyExpenseItem.mockResolvedValue([bonusItem('5000')]);

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.employees).toEqual([]);
  });
});

describe('computeRevenueDeleteImpact — аванс/доплата другому сотруднику', () => {
  it('аванс: after = before + сумма аванса (аванс перестаёт вычитаться)', async () => {
    findManyExpenseItem.mockResolvedValue([
      { employeeId: 34, category: 'employeeAdvance', amount: '20000', employee: { name: 'Бота' } },
    ]);
    // Второй вызов calculateEmployeeMonthlySalary — для получателя аванса (id 34)
    calcSalary.mockImplementation((employeeId: number) =>
      Promise.resolve(employeeId === 19 ? ownerSalary({ totalSalary: 100000 }) : ownerSalary({ totalSalary: 50000 }))
    );

    const impact = await computeRevenueDeleteImpact(1);

    const recipient = impact?.employees.find((e) => e.employeeId === 34);
    expect(recipient).toEqual({ employeeId: 34, employeeName: 'Бота', before: 50000, after: 70000 });
  });

  it('доплата: after = before - сумма доплаты (доплата перестаёт прибавляться)', async () => {
    findManyExpenseItem.mockResolvedValue([
      { employeeId: 34, category: 'employeeSurcharge', amount: '5000', employee: { name: 'Айгерим' } },
    ]);
    calcSalary.mockImplementation((employeeId: number) =>
      Promise.resolve(employeeId === 19 ? ownerSalary({ totalSalary: 100000 }) : ownerSalary({ totalSalary: 50000 }))
    );

    const impact = await computeRevenueDeleteImpact(1);

    const recipient = impact?.employees.find((e) => e.employeeId === 34);
    expect(recipient).toEqual({ employeeId: 34, employeeName: 'Айгерим', before: 50000, after: 45000 });
  });

  it('единственный аванс 333: итог −335 после удаления становится 0, а не −2', async () => {
    findManyExpenseItem.mockResolvedValue([
      { employeeId: 34, category: 'employeeAdvance', amount: '333', employee: { name: 'Алиева' } },
    ]);
    calcSalary.mockImplementation((employeeId: number) =>
      Promise.resolve(employeeId === 19 ? ownerSalary() : ownerSalary({ totalSalary: -335, grossAccrued: 0, totalAdvances: 333 }))
    );

    const impact = await computeRevenueDeleteImpact(1);

    const recipient = impact?.employees.find((e) => e.employeeId === 34);
    expect(recipient).toEqual({ employeeId: 34, employeeName: 'Алиева', before: -335, after: 0 });
  });

  it('«после» считается от точного итога: округлённый «до» дал бы на 5 ₸ меньше', async () => {
    // Начислено 1000, авансы 331 + 2: к выплате 667 → 665. Без аванса 2 станет 669 → 670.
    // От округлённого «до» вышло бы 665 + 2 = 667 → 665.
    findManyExpenseItem.mockResolvedValue([
      { employeeId: 34, category: 'employeeAdvance', amount: '2', employee: { name: 'Алиева' } },
    ]);
    calcSalary.mockImplementation((employeeId: number) =>
      Promise.resolve(employeeId === 19 ? ownerSalary() : ownerSalary({ totalSalary: 665, grossAccrued: 1000, totalAdvances: 333 }))
    );

    const impact = await computeRevenueDeleteImpact(1);

    const recipient = impact?.employees.find((e) => e.employeeId === 34);
    expect(recipient?.after).toBe(670);
  });

  it('аванс самому владельцу записи — объединяется в одну запись employees, а не дублируется', async () => {
    findManyExpenseItem.mockResolvedValue([
      { employeeId: 19, category: 'employeeAdvance', amount: '20000', employee: { name: 'Etel' } },
    ]);
    calcSalary.mockResolvedValue(ownerSalary({ totalSalary: 100000, dayShiftsCount: 0, salaryFromDayShifts: 0 }));
    findUniqueEntry.mockResolvedValue({ ...baseEntry, shiftType: null });

    const impact = await computeRevenueDeleteImpact(1);

    expect(impact?.employees).toHaveLength(1);
    expect(impact?.employees[0]).toEqual({ employeeId: 19, employeeName: 'Etel', before: 100000, after: 120000 });
  });
});
