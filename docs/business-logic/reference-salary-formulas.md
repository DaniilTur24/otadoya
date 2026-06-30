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

revenuePremiumDayShifts     = (revenueDayShifts     − 200000 × dayShiftsCount)     × 0.015
revenuePremiumFullDayShifts = (revenueFullDayShifts − 300000 × fullDayShiftsCount) × 0.015
totalRevenuePremium = revenuePremiumDayShifts + revenuePremiumFullDayShifts

totalSalary = salaryFromDayShifts + salaryFromFullDayShifts + salaryFromFiveDayShifts
            + totalBonuses + totalRevenuePremium + allowance
            − totalAdvances
```

`revenueDayShifts`/`revenueFullDayShifts` — сумма `cashRevenue + terminalRevenue + kaspiRevenue` по записям с соответствующим `shiftType` за месяц. Премия считается от **средней** выручки за смену данного типа, не от каждой смены по отдельности — порог сравнивается с суммой выручки минус (порог × количество смен), то есть фактически это «средняя выручка за смену минус порог, умножить на ставку», просуммированная по всем сменам этого типа разом. **Премия может быть отрицательной** — она не floor'ится в 0, то есть недобор по выручке буквально вычитается из зарплаты через `totalRevenuePremium`.

`totalBonuses` — сумма строк `DailyExpenseItem` с `category = 'pharmaBonus'` по записям сотрудника за месяц.

## manager_trading — заведующая, которая торгует

Окладная часть идентична `seller` (те же `/15`, `/10`, `/workingCalendarDays` за day/full_day/five_day смены). Отличия:

- **Нет** `revenuePremium` — для управляющих типов он не считается.
- Вместо него: **10% от бонусов управляемых аптек** + **лестничная премия аптеки**.

```
managerBonusShare  = 0.10 × Σ(pharmaBonus управляемых аптек за месяц)   // MANAGER_BONUS_SHARE_PERCENT
managerLadderPremium = computeLadderPremium(revenue аптеки, Pharmacy.managerPremiumThreshold/Base/StepAmount/StepBonus)

totalSalary = salaryFromDayShifts + salaryFromFullDayShifts + salaryFromFiveDayShifts
            + totalBonuses + managerBonusShare + allowance + managerLadderPremium
            − totalAdvances
```

`totalBonuses` здесь — те же бонусы, что у продавца (по своим сменам), а `managerBonusShare` — отдельная 10%-доля от **всех** бонусов аптек, которыми управляет заведующая (может включать бонусы других продавцов той же аптеки). Если передан `pharmacyId`, управляемые аптеки сужаются до пересечения с этим `pharmacyId`.

## manager_fixed — заведующая без торговли

Окладная часть — только пятидневка по табелю (`AttendanceShift`), сменных day/full_day у этого типа нет (API блокирует назначение `shiftType` для `ATTENDANCE_BASED_TYPES`).

```
salaryFromFiveDayShifts = baseSalary / workingCalendarDays × attendanceShiftsCount

totalSalary = salaryFromFiveDayShifts + managerBonusShare + allowance + managerLadderPremium − totalAdvances
```

`managerBonusShare` и `managerLadderPremium` считаются так же, как у `manager_trading` (одна и та же функция `computeManagerLadderPremium`/`computeManagerBonusShare`, одни и те же поля `Pharmacy.managerPremium*`).

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

Используется для `manager_trading`, `manager_fixed`, `pharmacy_manager` (поля `Pharmacy.managerPremiumThreshold/Base/StepAmount/StepBonus`, настраиваются на `/settings/pharmacies/[id]`). У офиса — другая функция (`findOfficeTierBonus`, диапазоны без накопления шагов), см. выше.

## Калькулятор для всех сотрудников разом

`calculateAllEmployeesSalaries(month, year, pharmacyId?)` — перебирает всех активных сотрудников. Продавцов/уборщиц с нулевым числом записей за месяц (`recordsCount === 0`) пропускает. `USER_LINKED_TYPES` (заведующие/менеджеры) включает всегда, даже с нулевой выработкой — у них доплата/премия начисляется независимо от личных смен.
