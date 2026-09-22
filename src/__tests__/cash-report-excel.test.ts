import { describe, it, expect } from 'vitest';
import { buildCashReportWorkbook } from '@/lib/cash-report-excel';
import type { CashReportPharmacySection, CashReportDay } from '@/lib/cash-report-builder';

function day(over: Partial<CashReportDay> & { date: string }): CashReportDay {
  const cashRevenue = over.cashRevenue ?? 0;
  const expenseLines = over.expenseLines ?? [];
  const cashExpensesTotal = expenseLines.filter((l) => l.affectsCash).reduce((s, l) => s + l.amount, 0);
  return {
    employeeNames: ['Иванова'],
    statuses: ['approved'],
    cashRevenue,
    expenseLines,
    cashExpensesTotal,
    cashNet: cashRevenue - cashExpensesTotal,
    ...over,
  };
}

function section(days: CashReportDay[]): CashReportPharmacySection {
  return {
    pharmacyId: 1,
    pharmacyName: 'Думан',
    days,
    totalCashRevenue: days.reduce((s, d) => s + d.cashRevenue, 0),
    totalCashExpenses: days.reduce((s, d) => s + d.cashExpensesTotal, 0),
    totalCashNet: days.reduce((s, d) => s + d.cashNet, 0),
  };
}

/**
 * Читает лист как массив строк. Колонка F — «Общий оборот» (turnover, посуточный, без
 * переноса), колонка G — «Сальдо» (balance, сквозной, с переносом и инкассацией).
 */
async function rowsOf(sections: CashReportPharmacySection[]) {
  const wb = await buildCashReportWorkbook(sections, { from: null, to: null, statusFilter: null });
  const sheet = wb.worksheets[0];
  const rows: { first: string; item: string; income: unknown; expense: unknown; turnover: unknown; balance: unknown }[] = [];
  sheet.eachRow((row) => {
    rows.push({
      first: String(row.getCell(1).value ?? ''),
      item: String(row.getCell(3).value ?? ''),
      income: row.getCell(4).value,
      expense: row.getCell(5).value,
      turnover: row.getCell(6).value,
      balance: row.getCell(7).value,
    });
  });
  return rows;
}

describe('buildCashReportWorkbook', () => {
  it('переносит сальдо между днями и вычитает взнос в банк', async () => {
    const rows = await rowsOf([
      section([
        day({
          date: '2026-09-01',
          cashRevenue: 300_000,
          balance: { openingBalance: 0, deposit: 250_000, closingBalance: 50_000 },
        }),
        day({
          date: '2026-09-02',
          cashRevenue: 100_000,
          balance: { openingBalance: 50_000, deposit: 0, closingBalance: 150_000 },
        }),
      ]),
    ]);

    const opening = rows.filter((r) => r.item === 'Остаток с прошлого дня');
    expect(opening.map((r) => r.balance)).toEqual([0, 50_000]);
    // Остаток с прошлого дня — это только сальдо, в оборот дня он не входит.
    expect(opening.map((r) => r.turnover)).toEqual(['', '']);

    const deposit = rows.find((r) => r.item === 'Сдано в банк');
    expect(deposit?.expense).toBe(250_000);
    expect(deposit?.balance).toBe(50_000);
    expect(deposit?.turnover).toBe(50_000); // 300000 выручки - 250000 инкассации, тот же день

    // Второй день открывается тем же сальдо, каким закрылся первый.
    const totals = rows.filter((r) => r.first.startsWith('Итого за'));
    expect(totals.map((r) => r.balance)).toEqual([50_000, 150_000]);
  });

  it('в итоге за период показывает последнее сальдо, а не сумму дней', async () => {
    const rows = await rowsOf([
      section([
        day({ date: '2026-09-01', cashRevenue: 300_000, balance: { openingBalance: 0, deposit: 250_000, closingBalance: 50_000 } }),
        day({ date: '2026-09-02', cashRevenue: 100_000, balance: { openingBalance: 50_000, deposit: 0, closingBalance: 150_000 } }),
      ]),
    ]);

    const period = rows.find((r) => r.first === 'ИТОГО ЗА ПЕРИОД');
    expect(period?.balance).toBe(150_000);
    // Расход за период включает и взносы в банк.
    expect(period?.expense).toBe(250_000);
  });

  it('оставляет колонку сальдо пустой, если у аптеки не задан месяц старта', async () => {
    const rows = await rowsOf([section([day({ date: '2026-09-01', cashRevenue: 300_000 })])]);

    expect(rows.some((r) => r.item === 'Остаток с прошлого дня')).toBe(false);
    const revenue = rows.find((r) => r.item === 'Выручка нал.');
    expect(revenue?.balance).toBeFalsy();
    // Итог дня тоже не должен подставлять сюда оборот — иначе его примут за сальдо.
    const total = rows.find((r) => r.first.startsWith('Итого за'));
    expect(total?.balance).toBeFalsy();
    // "Общий оборот" не зависит от месяца старта и всё равно считается.
    expect(total?.turnover).toBe(300_000);
  });

  it('строит "Общий оборот" пошагово внутри дня (приход, затем минус каждый расход) без переноса между днями', async () => {
    const rows = await rowsOf([
      section([
        day({
          date: '2026-09-01',
          cashRevenue: 300_000,
          expenseLines: [
            { category: 'rentExpenses', categoryLabel: 'Аренда', amount: 50_000, comment: null, recipientName: null, affectsCash: true },
            { category: 'employeeAdvance', categoryLabel: 'Зарплата', amount: 20_000, comment: null, recipientName: 'Иван', affectsCash: true },
          ],
        }),
        day({ date: '2026-09-02', cashRevenue: 100_000 }),
      ]),
    ]);

    const revenueRows = rows.filter((r) => r.item === 'Выручка нал.');
    expect(revenueRows.map((r) => r.turnover)).toEqual([300_000, 100_000]); // день 2 начинается заново с 0, не с 230000

    const expenseRows = rows.filter((r) => r.item === 'Аренда' || r.item === 'Зарплата — Иван');
    expect(expenseRows.map((r) => r.turnover)).toEqual([250_000, 230_000]); // 300000-50000, затем -20000

    const dayTotals = rows.filter((r) => r.first.startsWith('Итого за'));
    expect(dayTotals.map((r) => r.turnover)).toEqual([230_000, 100_000]);

    const period = rows.find((r) => r.first === 'ИТОГО ЗА ПЕРИОД');
    expect(period?.turnover).toBe(330_000); // сумма оборотов дней (без переноса/инкассации)
  });

  it('не даёт "Доплате" (не из кассы) сдвинуть ни оборот, ни сальдо', async () => {
    const rows = await rowsOf([
      section([
        day({
          date: '2026-09-01',
          cashRevenue: 100_000,
          expenseLines: [
            { category: 'employeeSurcharge', categoryLabel: 'Доплата', amount: 5_000, comment: null, recipientName: 'Иван', affectsCash: false },
          ],
          balance: { openingBalance: 10_000, deposit: 0, closingBalance: 110_000 },
        }),
      ]),
    ]);

    const surchargeRow = rows.find((r) => r.item.startsWith('Доплата'));
    expect(surchargeRow?.turnover).toBe(100_000); // не уменьшился
    expect(surchargeRow?.balance).toBe(110_000); // не уменьшился
  });
});
