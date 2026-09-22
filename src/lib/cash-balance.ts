export interface CashDayActivity {
  date: string; // YYYY-MM-DD
  cashRevenue: number;
  // Всё, что выдано из кассы за день: бонусы, зарплаты и прочие расходы.
  // Доплата сюда не входит — она не выдаётся наличными.
  cashExpenses: number;
  /** Часть движения выше, приходящаяся на записи со статусом «на проверке». */
  pendingCashRevenue: number;
  pendingCashExpenses: number;
}

/** Взнос наличными в банк за день. */
export interface CashMovementRecord {
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface CashDayBalance {
  date: string;
  openingBalance: number;
  cashRevenue: number;
  cashExpenses: number;
  /** Сколько физически в ящике на конец дня до того, как деньги увезли в банк. */
  balanceBeforeDeposit: number;
  deposit: number;
  closingBalance: number;
  /**
   * Какая часть остатка держится на записях «на проверке» — накопительно, включая
   * прошлые дни. Подтверждение записи остаток не меняет (она уже учтена), а отклонение
   * уменьшит его ровно на эту величину, поэтому её видно до принятия решения.
   */
  unconfirmed: number;
}

export interface CashBalanceResult {
  /** Остаток на утро первого дня запрошенного периода. */
  openingBalance: number;
  days: CashDayBalance[];
}

/**
 * Считает остаток наличных по дням, начиная с нуля от месяца старта.
 *
 * Никаких предположений о том, что лежало в кассе раньше: остаток целиком выводится
 * из записанных смен и инкассаций. Период, начинающийся позже месяца старта, всё равно
 * считается от него — иначе фильтр по датам «создавал» бы деньги, которых в кассе не было.
 */
export function computeCashBalances(params: {
  openingDate: string;
  activity: CashDayActivity[];
  movements: CashMovementRecord[];
  from?: string;
  to?: string;
}): CashBalanceResult {
  const { openingDate, activity, movements, from, to } = params;
  const openingAmount = 0;

  const activityByDate = new Map<string, CashDayActivity>();
  for (const day of activity) {
    if (day.date < openingDate) continue;
    const existing = activityByDate.get(day.date);
    if (existing) {
      existing.cashRevenue += day.cashRevenue;
      existing.cashExpenses += day.cashExpenses;
      existing.pendingCashRevenue += day.pendingCashRevenue;
      existing.pendingCashExpenses += day.pendingCashExpenses;
    } else {
      activityByDate.set(day.date, { ...day });
    }
  }

  const depositsByDate = new Map<string, number>();
  for (const movement of movements) {
    if (movement.date < openingDate) continue;
    depositsByDate.set(movement.date, (depositsByDate.get(movement.date) ?? 0) + movement.amount);
  }

  const dates = [...new Set([...activityByDate.keys(), ...depositsByDate.keys()])]
    .filter((date) => (to ? date <= to : true))
    .sort();

  let running = openingAmount;
  let openingBalance = openingAmount;
  let unconfirmed = 0;
  const days: CashDayBalance[] = [];

  for (const date of dates) {
    const day = activityByDate.get(date);
    const deposit = depositsByDate.get(date) ?? 0;

    const cashRevenue = day?.cashRevenue ?? 0;
    const cashExpenses = day?.cashExpenses ?? 0;
    const balanceBeforeDeposit = running + cashRevenue - cashExpenses;
    const closingBalance = balanceBeforeDeposit - deposit;

    unconfirmed += (day?.pendingCashRevenue ?? 0) - (day?.pendingCashExpenses ?? 0);

    if (from && date < from) {
      // День до начала периода: в выдачу не попадает, но остаток переносит.
      openingBalance = closingBalance;
    } else {
      days.push({
        date,
        openingBalance: running,
        cashRevenue,
        cashExpenses,
        balanceBeforeDeposit,
        deposit,
        closingBalance,
        unconfirmed,
      });
    }

    running = closingBalance;
  }

  return { openingBalance, days };
}

/** Сколько предлагать сдать в банк: всё, что накопилось в кассе. Сумму можно поправить. */
export function suggestDeposit(balanceBeforeDeposit: number): number {
  return Math.max(0, balanceBeforeDeposit);
}
