# Справочник: типы сотрудников (employeeType)

Полное техническое описание всех значений `Employee.employeeType`. Формулы зарплаты — в [reference-salary-formulas.md](reference-salary-formulas.md). Зачем вообще два разных механизма учёта смен — в [explanation-revenue-vs-attendance.md](explanation-revenue-vs-attendance.md).

Источник истины в коде: [`src/lib/employee-types.ts`](../../src/lib/employee-types.ts).

## Сводная таблица

| `employeeType` | Label в UI | Источник смен | Создаётся на | Привязка к User |
|---|---|---|---|---|
| `seller` | Продавец | `DailyRevenueEntry.shiftType` (`day`/`full_day`/`five_day`); при включённом `fiveDayViaAttendance` — **только** `AttendanceShift`, смена в записи выручки блокируется целиком ("всё или ничего") | `/employees` | нет |
| `seller_five_day_fixed` | Суточник / пятидневка (фикс) | оба источника одновременно (не в одну дату): `DailyRevenueEntry.shiftType` (`day`/`full_day`, от `baseSalary`) **и** `AttendanceShift` (от `shiftRate`, фикс. ставка без деления на календарь) | `/employees` | нет |
| `manager_trading` | Заведующая (торгует) | `DailyRevenueEntry.shiftType`; при включённом `fiveDayViaAttendance` — **оба** источника одновременно, не в одну дату (как `seller_five_day_fixed`, но по формуле `baseSalary/workingCalendarDays`, а не фикс. ставкой) | `/users` | да |
| `manager_fixed` | Заведующая (не торгует) | `AttendanceShift` | `/users` | да |
| `cleaner` | Уборщица | `AttendanceShift` | `/employees` | нет |
| `office` | Офис | `AttendanceShift` | `/employees` | нет |
| `pharmacy_manager` | Менеджер | `AttendanceShift` | `/users` | да |

## Константы-группы (`src/lib/employee-types.ts`)

- **`ATTENDANCE_BASED_TYPES`** = `{manager_fixed, cleaner, office, pharmacy_manager}` — зарплата считается **только** по отметкам в табеле (`AttendanceShift`), смена в записи выручки для них запрещена полностью. `seller_five_day_fixed` сюда **не входит** — ему разрешены оба источника одновременно, см. `canGetRevenueShift`/`canMarkAttendance` ниже. Проверки: `validateShiftEmployeeType` в `src/lib/revenue-validation.ts` (можно ли назначить смену) и `POST /api/attendance` (можно ли отметить табель).
- **`FIVE_DAY_VIA_ATTENDANCE_TYPES`** = `{seller, manager_trading}` — единственные два типа, у которых `Employee.fiveDayViaAttendance` вообще что-то значит: включает учёт пятидневных дней через `AttendanceShift`, по формуле `baseSalary/workingCalendarDays × attendanceCount`. Для `manager_trading` чекбокс — на `/users` (там же, где остальные её переключатели); для `seller` — на `/employees`. У `manager_fixed`/`pharmacy_manager`/`office`/`cleaner` поле неприменимо (они и так только по табелю). **Важно:** у `seller` и `manager_trading` флаг работает по-разному — см. следующий пункт.
- **Поведение флага различается по типу.** У `seller` это переключатель "всё или ничего": включив `fiveDayViaAttendance`, продавец на весь месяц теряет возможность получить смену в записи выручки (`canGetRevenueShift` → `false`), только табель. У `manager_trading` — наоборот, смешанный режим: смена в выручке остаётся разрешённой (`canGetRevenueShift` → `true` даже при включённом флаге), она может совмещать день/сутки и пятидневку в одном месяце, просто не на одну и ту же дату — как `seller_five_day_fixed`, но с формулой `baseSalary/workingCalendarDays`, а не фиксированной ставкой. За это отвечает внутренняя `FIVE_DAY_VIA_ATTENDANCE_BLOCKS_SHIFTS_TYPES = {seller}` (не экспортируется, видна только через поведение `canGetRevenueShift`).
- **`canGetRevenueShift(employee)` / `canMarkAttendance(employee)`** (`src/lib/employee-types.ts`) — единая точка правды о том, какой источник смен разрешён конкретному сотруднику. Используется и на бэкенде (`revenue-validation.ts`, `/api/attendance*`), и во фронтенде (`/attendance`, `/revenue`, `/revenue/new`). Для `seller_five_day_fixed` и `manager_trading` с `fiveDayViaAttendance` оба возвращают `true` — конфликт на одну и ту же дату проверяется отдельно: `validateNoAttendanceOnDate` (в `revenue-validation.ts`, вызывается из `/api/revenue*`) и `validateNoShiftOnDate` (в `src/lib/attendance-validation.ts`, вызывается из `/api/attendance*`) — 409, если на дату уже есть запись с другой стороны. Эти две проверки не завязаны на конкретный тип — они одинаково защищают любую комбинацию employeeType, у которой в принципе могут столкнуться оба источника.
- **`MANAGER_TYPES`** = `{manager_trading, manager_fixed, pharmacy_manager}` — все три получают одинаковый набор из двух независимых переключателей на карточке сотрудника: `managerBonusShareEnabled` (10%-доля от `pharmaBonus` управляемых аптек, `MANAGER_BONUS_SHARE_PERCENT = 0.1`) и `ladderPremiumEnabled` (лестничная премия по выручке аптеки, `Pharmacy.managerPremium*`). Любая комбинация возможна — оба включены, только один, или ни одного; переключатели не зависят от `employeeType`. Для `manager_trading`, пока `ladderPremiumEnabled` выключен, вместо лестницы начисляется личная `revenuePremium`, такая же, как у продавца (см. [reference-salary-formulas.md](reference-salary-formulas.md)) — у `manager_fixed`/`pharmacy_manager` такой личной премии нет вообще (они не привязаны к сменам с кассой).
- **`USER_LINKED_TYPES`** = `{manager_trading, manager_fixed, pharmacy_manager}` — карточка `Employee` для этих типов создаётся и редактируется только вместе с аккаунтом `User` на `/users`. Прямое редактирование имени/оклада/типа/доплаты на `/employees/[id]` для них заблокировано на уровне API (`PUT /api/employees/[id]` вернёт 400, если затронуто одно из этих полей у `USER_LINKED_TYPES`-сотрудника). Эти же типы **включаются** в `calculateAllEmployeesSalaries()` даже при нулевом количестве записей за месяц — доплата/премия начисляется независимо от личной выработки.

## Отличия по полям Employee

| Поле | Кто использует |
|---|---|
| `baseSalary` | все, кроме `cleaner` (там 0, используется `shiftRate`); у `seller_five_day_fixed` — только сменная часть (день/сутки из выручки), необязателен, если у сотрудника вообще не бывает смен из выручки |
| `shiftRate` | `cleaner` — ставка за одну отмеченную смену в табеле; `seller_five_day_fixed` — та же механика (фикс. ставка × кол-во отметок табеля, без деления на `WorkingCalendar.workingDays`), необязателен, если у сотрудника вообще не бывает отметок табеля |
| `ladderPremiumEnabled` | `manager_trading`/`manager_fixed`/`pharmacy_manager` — включает/выключает лестничную премию аптеки лично для сотрудника |
| `managerBonusShareEnabled` | `manager_trading`/`manager_fixed`/`pharmacy_manager` — включает/выключает 10%-долю от бонусов аптеки лично для сотрудника |
| `allowance` / `allowanceDescription` | любой тип — фиксированная ежемесячная доплата, прибавляется к итогу всегда |

## Не путать с session role

`employeeType` не имеет отношения к ролям сессии (`admin`/`bookkeeper`/`manager` в `src/lib/api-auth.ts`). Роль управляет доступом к страницам/API, `employeeType` — формулой зарплаты. У `manager_trading`/`manager_fixed`/`pharmacy_manager` всегда есть и `User.role = 'manager'`, и `Employee.employeeType`, но это два разных поля в двух разных таблицах.
