import { describe, it, expect } from 'vitest';
import { computeCashBalances, suggestDeposit, type CashDayActivity } from '@/lib/cash-balance';

function day(date: string, cashRevenue: number, cashExpenses = 0, pending = false): CashDayActivity {
  return {
    date,
    cashRevenue,
    cashExpenses,
    pendingCashRevenue: pending ? cashRevenue : 0,
    pendingCashExpenses: pending ? cashExpenses : 0,
  };
}

describe('computeCashBalances', () => {
  it('начинает с нуля и копит остаток по дням', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 100_000), day('2026-09-02', 50_000)],
      movements: [],
    });

    expect(days[0].openingBalance).toBe(0);
    expect(days[0].closingBalance).toBe(100_000);
    expect(days[1].openingBalance).toBe(100_000);
    expect(days[1].closingBalance).toBe(150_000);
  });

  it('уменьшает остаток на взнос в банк и переносит разницу дальше', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 300_000, 180_000), day('2026-09-02', 100_000)],
      movements: [{ date: '2026-09-01', amount: 100_000 }],
    });

    expect(days[0].balanceBeforeDeposit).toBe(120_000);
    expect(days[0].closingBalance).toBe(20_000);
    expect(days[1].closingBalance).toBe(120_000);
  });

  it('переносит остаток через границу месяца, а не обнуляет его', () => {
    // Выручку за последний день месяца обычно везут в банк уже в следующем.
    // При сбросе на 1-е такая инкассация увела бы новый месяц в минус.
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-30', 300_000), day('2026-10-01', 50_000)],
      movements: [{ date: '2026-10-01', amount: 300_000 }],
    });

    expect(days[1].openingBalance).toBe(300_000);
    expect(days[1].closingBalance).toBe(50_000);
  });

  it('уводит кассу в минус, когда в банк сдали больше, чем в ней было', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-14',
      activity: [day('2026-09-14', 100_000)],
      movements: [{ date: '2026-09-14', amount: 120_000 }],
    });

    expect(days[0].closingBalance).toBe(-20_000);
  });

  it('считает остаток на начало периода от месяца старта, а не с первого видимого дня', () => {
    const { openingBalance, days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 100_000), day('2026-09-02', 50_000), day('2026-09-03', 10_000)],
      movements: [],
      from: '2026-09-03',
    });

    expect(openingBalance).toBe(150_000);
    expect(days).toHaveLength(1);
    expect(days[0].openingBalance).toBe(150_000);
    expect(days[0].closingBalance).toBe(160_000);
  });

  it('не берёт в расчёт всё, что было до месяца старта', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-08-20', 999_999), day('2026-09-01', 5_000)],
      movements: [{ date: '2026-08-20', amount: 500_000 }],
    });

    expect(days).toHaveLength(1);
    expect(days[0].openingBalance).toBe(0);
    expect(days[0].closingBalance).toBe(5_000);
  });

  it('складывает несколько смен одного дня в один остаток', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 100_000, 10_000), day('2026-09-01', 47_155, 5_000)],
      movements: [],
    });

    expect(days).toHaveLength(1);
    expect(days[0].cashRevenue).toBe(147_155);
    expect(days[0].cashExpenses).toBe(15_000);
    expect(days[0].closingBalance).toBe(132_155);
  });

  it('обрезает период сверху, не теряя накопленный остаток', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 10_000), day('2026-09-05', 10_000)],
      movements: [],
      to: '2026-09-01',
    });

    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-09-01');
  });

  it('показывает, какая часть остатка держится на записях на проверке', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 100_000, 10_000, true)],
      movements: [],
    });

    expect(days[0].closingBalance).toBe(90_000);
    expect(days[0].unconfirmed).toBe(90_000);
    expect(days[0].closingBalance - days[0].unconfirmed).toBe(0);
  });

  it('накапливает непроверенное по дням, а не считает его заново каждый день', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [
        day('2026-09-01', 50_000, 0, true),
        day('2026-09-02', 30_000),
        day('2026-09-03', 70_000, 0, true),
      ],
      movements: [],
    });

    expect(days.map((d) => d.unconfirmed)).toEqual([50_000, 50_000, 120_000]);
  });

  it('учитывает непроверенную смену со знаком минус, если она потратила больше, чем принесла', () => {
    // Отклонение такой смены остаток не уменьшит, а увеличит — это должно быть видно.
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 60_000, 156_000, true)],
      movements: [],
    });

    expect(days[0].unconfirmed).toBe(-96_000);
  });

  it('не помечает остаток непроверенным, когда все смены подтверждены', () => {
    const { days } = computeCashBalances({
      openingDate: '2026-09-01',
      activity: [day('2026-09-01', 100_000)],
      movements: [],
    });

    expect(days[0].unconfirmed).toBe(0);
  });

  it('без движений и смен не выдаёт ни одного дня', () => {
    const result = computeCashBalances({ openingDate: '2026-09-01', activity: [], movements: [] });

    expect(result.days).toEqual([]);
    expect(result.openingBalance).toBe(0);
  });
});

describe('suggestDeposit', () => {
  it('предлагает сдать весь накопленный остаток', () => {
    expect(suggestDeposit(140_000)).toBe(140_000);
  });

  it('ничего не предлагает, когда касса в минусе', () => {
    expect(suggestDeposit(-5_000)).toBe(0);
  });
});
