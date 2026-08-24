# Справочник: типы сотрудников (employeeType)

Полное техническое описание всех значений `Employee.employeeType`. Формулы зарплаты — в [reference-salary-formulas.md](reference-salary-formulas.md). Зачем вообще два разных механизма учёта смен — в [explanation-revenue-vs-attendance.md](explanation-revenue-vs-attendance.md).

Источник истины в коде: [`src/lib/employee-types.ts`](../../src/lib/employee-types.ts).

## Сводная таблица

| `employeeType` | Label в UI | Источник смен | Создаётся на | Привязка к User |
|---|---|---|---|---|
| `seller` | Продавец | `DailyRevenueEntry.shiftType` (`day`/`full_day`/`five_day`) | `/employees` | нет |
| `manager_trading` | Заведующая (торгует) | `DailyRevenueEntry.shiftType` | `/users` | да |
| `manager_fixed` | Заведующая (не торгует) | `AttendanceShift` | `/users` | да |
| `cleaner` | Уборщица | `AttendanceShift` | `/employees` | нет |
| `office` | Офис | `AttendanceShift` | `/employees` | нет |
| `pharmacy_manager` | Менеджер | `AttendanceShift` | `/users` | да |

## Константы-группы (`src/lib/employee-types.ts`)

- **`ATTENDANCE_BASED_TYPES`** = `{manager_fixed, cleaner, office, pharmacy_manager}` — зарплата считается по отметкам в табеле (`AttendanceShift`), а не по сменам в записи выручки. Этим типам **нельзя** назначить `shiftType` в `DailyRevenueEntry` (см. `validateShiftEmployeeType` в `src/lib/revenue-validation.ts`) и, наоборот, типам не из этого списка нельзя отметить табель (см. `POST /api/attendance`).
- **`MANAGER_TYPES`** = `{manager_trading, manager_fixed}` — оба получают 10%-долю от `pharmaBonus` управляемых аптек (`MANAGER_BONUS_SHARE_PERCENT = 0.1`). Лестничная премия по выручке аптеки (`Pharmacy.managerPremium*`) обязательна у `manager_fixed` и опциональна у `manager_trading` (флаг `ladderPremiumEnabled`) — пока она выключена, `manager_trading` получает личную `revenuePremium`, такую же, как у продавца (см. [reference-salary-formulas.md](reference-salary-formulas.md)). `pharmacy_manager` в группу `MANAGER_TYPES` не входит — у него нет 10%-доли, а лестничная премия опциональна (флаг `managerPremiumEnabled`).
- **`USER_LINKED_TYPES`** = `{manager_trading, manager_fixed, pharmacy_manager}` — карточка `Employee` для этих типов создаётся и редактируется только вместе с аккаунтом `User` на `/users`. Прямое редактирование имени/оклада/типа/доплаты на `/employees/[id]` для них заблокировано на уровне API (`PUT /api/employees/[id]` вернёт 400, если затронуто одно из этих полей у `USER_LINKED_TYPES`-сотрудника). Эти же типы **включаются** в `calculateAllEmployeesSalaries()` даже при нулевом количестве записей за месяц — доплата/премия начисляется независимо от личной выработки.

## Отличия по полям Employee

| Поле | Кто использует |
|---|---|
| `baseSalary` | все, кроме `cleaner` (там 0, используется `shiftRate`) |
| `shiftRate` | только `cleaner` — ставка за одну отмеченную смену в табеле |
| `managerPremiumEnabled` | только `pharmacy_manager` — включает/выключает лестничную премию аптеки лично для него |
| `allowance` / `allowanceDescription` | любой тип — фиксированная ежемесячная доплата, прибавляется к итогу всегда |

## Не путать с session role

`employeeType` не имеет отношения к ролям сессии (`admin`/`bookkeeper`/`manager` в `src/lib/api-auth.ts`). Роль управляет доступом к страницам/API, `employeeType` — формулой зарплаты. У `manager_trading`/`manager_fixed`/`pharmacy_manager` всегда есть и `User.role = 'manager'`, и `Employee.employeeType`, но это два разных поля в двух разных таблицах.
