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

## seller_five_day_fixed — суточник / пятидневка (фикс)

Один тип, покрывающий два сценария: сотрудник, который **только** отмечается в табеле (по факту никогда не получает смену в записи выручки), и сотрудник, который **иногда** ещё и выходит на день/сутки. Разница между ними — не в типе, а в том, назначают ли ему когда-либо смену.

Сменная часть (день/сутки) идентична `seller` — от `baseSalary`, включая `revenuePremium` и `pharmaBonus`. Пятидневная часть — по табелю посещаемости (`AttendanceShift`), но **фиксированной ставкой** `shiftRate` (то же поле, что у `cleaner`), **без деления на `WorkingCalendar.workingDays`** — в отличие от `fiveDayViaAttendance` у `seller` (см. ниже).

```
salaryFromDayShifts     = baseSalary / 15 × dayShiftsCount
salaryFromFullDayShifts = baseSalary / 10 × fullDayShiftsCount
salaryFromFiveDayShifts = shiftRate × attendanceShiftsCount        (0, если shiftRate не задан)

revenuePremium, totalBonuses — как у seller (только от дней со сменой из выручки)

totalSalary = salaryFromDayShifts + salaryFromFullDayShifts + salaryFromFiveDayShifts
            + totalBonuses + totalRevenuePremium + allowance
            − totalAdvances
```

Оба источника смен разрешены одновременно, но не на одну и ту же календарную дату — сервер отклоняет с 409 попытку назначить смену на дату с уже отмеченным табелем (`validateNoAttendanceOnDate`, `src/lib/revenue-validation.ts`) и наоборот, отметить табель на дату с уже назначенной сменой (`validateNoShiftOnDate`, `src/lib/attendance-validation.ts`).

`baseSalary` не обязателен, если у сотрудника никогда не бывает смен из выручки (чистый табельный сценарий); `shiftRate` не обязателен, если табель не используется вовсе.

## manager_trading — заведующая, которая торгует

Окладная часть идентична `seller` (те же `/15`, `/10` за day/full_day смены). Дополнительно к этому — два независимых переключателя на карточке сотрудника (`/users`), в любой комбинации: `managerBonusShareEnabled` (10% от бонусов управляемых аптек) и `ladderPremiumEnabled` (лестничная премия аптеки вместо личной премии за выручку смены). Те же два переключателя есть у `manager_fixed` и `pharmacy_manager` — см. ниже.

**`fiveDayViaAttendance` у неё работает не так, как у продавца.** Если включён на `/users`, её пятидневные дни читаются из `AttendanceShift`, но оплачиваются **фиксированной ставкой** `shiftRate × attendanceCount` (то же поле `shiftRate`, что у `cleaner`/`seller_five_day_fixed`), **без деления на `WorkingCalendar.workingDays`** — заведующая, которая торгует, набирает эти дни так же, как любой сотрудник на фиксированной ставке, а не как оклад-зависимый табельный тип. Заведующей, которой действительно нужна оплата от оклада/календаря без личных смен вообще, для этого есть отдельный тип `manager_fixed` (см. ниже). В отличие от `seller`, смена в записи выручки при этом **не блокируется**: она может совмещать день/сутки и пятидневку в одном месяце (как `seller_five_day_fixed`), просто не на одну и ту же календарную дату (см. `canGetRevenueShift`/`FIVE_DAY_VIA_ATTENDANCE_TYPES` в [reference-employee-types.md](reference-employee-types.md)). Формула расчёта одна и та же независимо от того, есть ли у неё в этом месяце ещё и day/full_day-смены — `salaryFromDayShifts`/`salaryFromFullDayShifts` и `salaryFromFiveDayShifts` считаются и суммируются независимо друг от друга. Если ставка не задана, а дни в табеле уже отмечены — `shiftRateMissing` не даёт закрыть месяц с тихим нулём (симметрично `calendarMissing` у оклад-зависимых типов).

Премия за выручку смены (`revenuePremium`) зависит от `ladderPremiumEnabled`:
- **выключен** (по умолчанию) — заведующая получает премию за выручку смены, по той же формуле, что и продавец (порог 200k/300k, ставка 1.5%, floor в 0 на каждый тип смены независимо);
- **включён** — вместо этой премии она получает лестничную премию аптеки (`managerLadderPremium`), как у `manager_fixed`/`pharmacy_manager` (см. ниже).

```
useLadder      = ladderPremiumEnabled
useBonusShare  = managerBonusShareEnabled

revenuePremiumDayShifts     = useLadder ? 0 : max(0, (revenueDayShifts     − 200000 × dayShiftsCount)     × 0.015)
revenuePremiumFullDayShifts = useLadder ? 0 : max(0, (revenueFullDayShifts − 300000 × fullDayShiftsCount) × 0.015)
totalRevenuePremium = revenuePremiumDayShifts + revenuePremiumFullDayShifts

managerBonusShare = useBonusShare
  ? 0.10 × Σ(pharmaBonus управляемых аптек за месяц)   // MANAGER_BONUS_SHARE_PERCENT
  : 0

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

managerBonusShare    = managerBonusShareEnabled ? 0.10 × Σ(pharmaBonus управляемых аптек за месяц) : 0
managerLadderPremium = ladderPremiumEnabled ? computeManagerLadderPremium(revenue управляемых аптек, Pharmacy.managerPremium*) : 0

totalSalary = salaryFromFiveDayShifts + managerBonusShare + allowance + managerLadderPremium − totalAdvances
```

`managerBonusShare` считается той же функцией (`computeManagerBonusShare`), что и у `manager_trading`. У `manager_fixed` нет личной `revenuePremium` за смену (смен с кассой нет вообще — только табель), поэтому `ladderPremiumEnabled` здесь не заменяет никакую другую премию, а просто включает/выключает `managerLadderPremium`.

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

managerBonusShare    = managerBonusShareEnabled ? 0.10 × Σ(pharmaBonus управляемых аптек за месяц) : 0
managerLadderPremium = ladderPremiumEnabled
  ? computeManagerLadderPremium(revenue управляемых аптек, Pharmacy.managerPremium*)
  : 0

totalSalary = salaryFromFiveDayShifts + managerBonusShare + managerLadderPremium + allowance − totalAdvances
```

Те же два независимых переключателя, что у `manager_trading`/`manager_fixed` — `managerBonusShareEnabled` (10% от бонусов) и `ladderPremiumEnabled` (лестничная премия), в любой комбинации. `pharmacy_manager` изначально задумывался как позиция без 10%-доли, но с добавлением независимых переключателей это стало вопросом настройки конкретной карточки, а не ограничением типа.

## Лестничная премия (`computeManagerLadderPremium`/`computeLadderPremium`) — общая логика

```
если revenue < threshold → премия = 0
иначе:
  премия = base
  steps  = floor((revenue − threshold) / stepAmount)
  премия += steps × stepBonus
```

Используется одинаково для `manager_trading`, `manager_fixed` и `pharmacy_manager` — включается независимым флагом `ladderPremiumEnabled` на карточке сотрудника, поля порога/шага берутся с `Pharmacy.managerPremiumThreshold/Base/StepAmount/StepBonus` (настраиваются на `/settings/pharmacies/[id]`, общие для всех сотрудников этой аптеки). У офиса — другая функция (`findOfficeTierBonus`, диапазоны без накопления шагов), см. выше.

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
