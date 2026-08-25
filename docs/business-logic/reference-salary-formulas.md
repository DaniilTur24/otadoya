# Справочник: формулы расчёта зарплаты

Источник истины: [`src/lib/salary-calculator.ts`](../../src/lib/salary-calculator.ts), функция `calculateEmployeeMonthlySalary(employeeId, month, year, pharmacyId?)`. Учитываются только записи/начисления со статусом `approved`. Если передан `pharmacyId` — расчёт фильтруется по аптеке (кроме `office`, где премия всегда от выручки всех аптек).

Зарплата **не хранится** как число в БД — она вычисляется заново при каждом запросе (`/api/employees/[id]/salary`, `/api/employees/salary-summary`, `computeMonthlyData()`).

## Общие для всех типов величины

- **Фиксированная доплата** (`Employee.allowance`) — прибавляется к итогу для любого `employeeType`, независимо от формулы.
- **Авансы** (`totalAdvances`) — вычитаются из итога для любого типа. Источник: `DailyExpenseItem` с `category = 'employeeAdvance'` и `employeeId` = получатель (см. [explanation-revenue-vs-attendance.md](explanation-revenue-vs-attendance.md#авансы-employeeadvance) про привязку получателя). Считает `computeAdvances()`.
- **`totalSalary`** может уйти в минус, если авансы превышают начисление — это ожидаемое поведение, не баг.

## seller — продавец

```
salaryFromDayShifts     = baseSalary / 15 × dayShiftsCount
salaryFromFullDayShifts = baseSalary / 10 × fullDayShiftsCount
salaryFromFiveDayShifts = baseSalary / workingCalendarDays × fiveDayShiftsCount   (0, если календарь месяца не заполнен)

revenuePremiumDayShifts     = max(0, (revenueDayShifts     − 200000 × dayShiftsCount)     × 0.015)
revenuePremiumFullDayShifts = max(0, (revenueFullDayShifts − 300000 × fullDayShiftsCount) × 0.015)
totalRevenuePremium = revenuePremiumDayShifts + revenuePremiumFullDayShifts

totalSalary = salaryFromDayShifts + salaryFromFullDayShifts + salaryFromFiveDayShifts
            + totalBonuses + totalRevenuePremium + allowance
            − totalAdvances
```

`revenueDayShifts`/`revenueFullDayShifts` — сумма `cashRevenue + terminalRevenue` (**без** `kaspiRevenue` — kaspi не учитывается при расчёте личной премии) по записям с соответствующим `shiftType` за месяц. Премия считается от **средней** выручки за смену данного типа, не от каждой смены по отдельности — порог сравнивается с суммой выручки минус (порог × количество смен), то есть фактически это «средняя выручка за смену минус порог, умножить на ставку», просуммированная по всем сменам этого типа разом. Каждый из двух компонентов (`revenuePremiumDayShifts`, `revenuePremiumFullDayShifts`) **floor'ится в 0 независимо** — премия это бонус сверху, а не штраф, поэтому недобор по выручке одного типа смены никогда не вычитается из оклада и не компенсируется избытком по другому типу смены.

`totalBonuses` — сумма строк `DailyExpenseItem` с `category = 'pharmaBonus'` по записям сотрудника за месяц.

## manager_trading — заведующая, которая торгует

Окладная часть идентична `seller` (те же `/15`, `/10`, `/workingCalendarDays` за day/full_day/five_day смены). Дополнительно к этому — **10% от бонусов управляемых аптек**.

Премия за выручку смены (`revenuePremium`) зависит от флага `ladderPremiumEnabled` на карточке сотрудника (`/users`):
- **выключен** (по умолчанию) — заведующая получает премию за выручку смены, по той же формуле, что и продавец (порог 200k/300k, ставка 1.5%, floor в 0 на каждый тип смены независимо);
- **включён** — вместо этой премии она получает лестничную премию аптеки (`managerLadderPremium`), как у `manager_fixed` (см. ниже).

```
useLadder = ladderPremiumEnabled

revenuePremiumDayShifts     = useLadder ? 0 : max(0, (revenueDayShifts     − 200000 × dayShiftsCount)     × 0.015)
revenuePremiumFullDayShifts = useLadder ? 0 : max(0, (revenueFullDayShifts − 300000 × fullDayShiftsCount) × 0.015)
totalRevenuePremium = revenuePremiumDayShifts + revenuePremiumFullDayShifts

managerBonusShare = 0.10 × Σ(pharmaBonus управляемых аптек за месяц)   // MANAGER_BONUS_SHARE_PERCENT

managerLadderPremium = useLadder
  ? computeManagerLadderPremium(revenue управляемых аптек, Pharmacy.managerPremium*)
  : 0

totalSalary = salaryFromDayShifts + salaryFromFullDayShifts + salaryFromFiveDayShifts
            + totalBonuses + totalRevenuePremium + managerBonusShare + managerLadderPremium + allowance
            − totalAdvances
```

`totalBonuses` здесь — те же бонусы, что у продавца (по своим сменам), а `managerBonusShare` — отдельная 10%-доля от **всех** бонусов аптек, которыми управляет заведующая (может включать бонусы других продавцов той же аптеки). Если передан `pharmacyId`, управляемые аптеки сужаются до пересечения с этим `pharmacyId`.

`revenueDayShifts`/`revenueFullDayShifts` в этой премии считаются **по каждой аптеке отдельно** (сотрудник может отработать смены в разных аптеках за месяц): если у аптеки, где отработана смена, включён `Pharmacy.poolAverageRevenuePremium` — вместо личной выручки сотрудника за смену берётся средняя выручка всей аптеки за смену того же типа за месяц (см. `computePooledShiftAverages` и раздел «Пул-премия по аптеке» ниже). Это касается и `seller`, и `manager_trading` (когда у неё выключена лестница).

## manager_fixed — заведующая без торговли

Окладная часть — только пятидневка по табелю (`AttendanceShift`), сменных day/full_day у этого типа нет (API блокирует назначение `shiftType` для `ATTENDANCE_BASED_TYPES`).

```
salaryFromFiveDayShifts = baseSalary / workingCalendarDays × attendanceShiftsCount

totalSalary = salaryFromFiveDayShifts + managerBonusShare + allowance + managerLadderPremium − totalAdvances
```

`managerBonusShare` считается той же функцией (`computeManagerBonusShare`), что и у `manager_trading`. `managerLadderPremium` (`computeManagerLadderPremium`, поля `Pharmacy.managerPremium*`) здесь применяется — это единственный из двух типов заведующих, кому она полагается.

## cleaner — уборщица

```
salaryFromShiftRate = shiftRate × attendanceShiftsCount

totalSalary = salaryFromShiftRate + allowance − totalAdvances
```

`baseSalary` для уборщицы не участвует в расчёте (поле есть в схеме, но формула использует только `shiftRate`).

## office — офисный сотрудник

```
salaryFromFiveDayShifts = baseSalary / workingCalendarDays × attendanceShiftsCount

officePremium = findOfficeTierBonus(суммарная выручка ВСЕХ аптек за месяц, OfficePremiumTier[])

totalSalary = salaryFromFiveDayShifts + officePremium + allowance − totalAdvances
```

`pharmacyId`-фильтр у office **не применяется** — табель может быть без привязки к аптеке (`AttendanceShift.pharmacyId = null`), а премия всегда считается от суммарной выручки всех аптек.

Премия — не лестница с накоплением шагов (в отличие от заведующих), а **выбор одного диапазона** из таблицы `OfficePremiumTier` (`fromAmount < revenue <= toAmount`, `toAmount = null` — без верхней границы). Премия фиксированная для всей строки, шаги внутри диапазона не суммируются. См. [explanation-salary-design.md](explanation-salary-design.md#почему-у-офиса-премия-устроена-иначе-чем-у-заведующих).

> CLAUDE.md описывает офисную премию как единую лестницу (`threshold/base/stepAmount/stepBonus`, модель `OfficePremiumSettings`) — это устарело. В текущей версии кода (`prisma/schema.prisma`, модель `OfficePremiumTier`) это таблица произвольных диапазонов выручки с фиксированной премией на диапазон, настраивается на `/settings/office-premium`.

## pharmacy_manager — менеджер

```
salaryFromFiveDayShifts = baseSalary / workingCalendarDays × attendanceShiftsCount

managerLadderPremium = managerPremiumEnabled
  ? computeLadderPremium(revenue управляемых аптек, Pharmacy.managerPremium*)
  : 0

totalSalary = salaryFromFiveDayShifts + managerLadderPremium + allowance − totalAdvances
```

В отличие от `manager_fixed`/`manager_trading`: **нет** `managerBonusShare` (10% от бонусов), и лестничная премия применяется только если на карточке сотрудника включён флаг `managerPremiumEnabled`.

## Лестничная премия (`computeLadderPremium`) — общая логика для заведующих

```
если revenue < threshold → премия = 0
иначе:
  премия = base
  steps  = floor((revenue − threshold) / stepAmount)
  премия += steps × stepBonus
```

Используется для `manager_fixed` (всегда), для `manager_trading` (опционально, флаг `ladderPremiumEnabled`) и для `pharmacy_manager` (опционально, флаг `managerPremiumEnabled`) — поля `Pharmacy.managerPremiumThreshold/Base/StepAmount/StepBonus`, настраиваются на `/settings/pharmacies/[id]`. У офиса — другая функция (`findOfficeTierBonus`, диапазоны без накопления шагов), см. выше.

## Пул-премия по аптеке (`Pharmacy.poolAverageRevenuePremium`, `computePooledShiftAverages`)

По умолчанию `revenuePremium` (и у `seller`, и у `manager_trading` без включённой лестницы) считается от **личной** выручки сотрудника за его смены. Если на карточке аптеки (`/settings/pharmacies/[id]`) включить галочку «Премия по средней выручке аптеки за смену», для смен, отработанных в этой аптеке, вместо личной выручки используется **средняя выручка аптеки** за смену того же типа за месяц:

```
avgDayRevenue     = Σ(cash+terminal всех подтверждённых смен «день» аптеки за месяц, без kaspi)  / кол-во таких смен
avgFullDayRevenue = Σ(cash+terminal всех подтверждённых смен «сутки» аптеки за месяц, без kaspi) / кол-во таких смен

revenuePremiumDayShifts (для этой аптеки)     = max(0, (avgDayRevenue     − 200000) × 0.015) × dayShiftsCount сотрудника
revenuePremiumFullDayShifts (для этой аптеки) = max(0, (avgFullDayRevenue − 300000) × 0.015) × fullDayShiftsCount сотрудника
```

Каждому сотруднику, отработавшему смену в этой аптеке в этом месяце (продавцу или заведующей без включённой лестницы), достаётся одна и та же премия «за смену», умноженная на количество его личных смен — а не сумма, зависящая от того, сколько лично он продал. «Пятидневки» (табельные типы и `shiftType = 'five_day'`) в этот расчёт не входят вовсе, как и обычно.

## Калькулятор для всех сотрудников разом

`calculateAllEmployeesSalaries(month, year, pharmacyId?)` — перебирает всех активных сотрудников. Продавцов/уборщиц с нулевым числом записей за месяц (`recordsCount === 0`) пропускает. `USER_LINKED_TYPES` (заведующие/менеджеры) включает всегда, даже с нулевой выработкой — у них доплата/премия начисляется независимо от личных смен.
