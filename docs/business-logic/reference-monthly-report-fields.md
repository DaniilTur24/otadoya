# Справочник: месячный отчёт (поля, источники, закрытие)

Источник истины: [`src/lib/monthly-report-builder.ts`](../../src/lib/monthly-report-builder.ts) (`computeMonthlyData`, `buildMonthlySnapshot`) и [`src/lib/monthly-report-fields.ts`](../../src/lib/monthly-report-fields.ts) (`MONTHLY_REPORT_ROWS`, `MONTHLY_EXPENSE_KEYS`). UI — `/reports/monthly`.

## Откуда берётся каждое поле

`computeMonthlyData(year, month)` строит `systemData[pharmacyId][fieldKey]`, последовательно накладывая источники друг на друга:

| # | Источник | Что заполняет |
|---|---|---|
| 1 | `DailyRevenueEntry` (status=`approved`, `excludedFromReport=false`) | `retailRevenue` (cash+terminal+kaspi), `kaspiRevenue` |
| 1b | `DailyExpenseItem` тех же записей | любое поле, чей `category` совпадает с ключом строки отчёта; несовпавшие категории → `otherExpenses`. `category='employeeAdvance'` **пропускается** — авансы не строка расхода, см. ниже |
| 2 | Зарплаты сотрудников (`calculateEmployeeMonthlySalary`) | `pharmaSalary` (seller/manager_trading/manager_fixed/pharmacy_manager), `cleaning` (cleaner), `officeSalary` (office, делится поровну между всеми активными аптеками) |
| 3 | `ExtractedExpenseEntry` (не банковские файлы, status=`approved`) | `category='rent'` → `rentExpenses`, `category='expense'` → `bankServices` |
| 4 | `ImportedReportValue` (банковский импорт, status=`approved`) | любое поле по `fieldKey` |
| 5 | `PharmacyPdfReport` (status=`confirmed`) | `stockRetail`, `stockWholesale`, `coefficient` (из `markupPercent`) |
| 6 | `MonthlyReportOverride` | перекрывает **любое** поле — применяется последним, при выводе через `resolveValue()` |

`wholesaleRevenue` и `totalExpenses`/`netIncome` — не хранятся в `systemData`, а вычисляются на лету в `resolveValue()`/`buildMonthlySnapshot()` (calc-поля).

### Почему зарплата попадает в отчёт именно так

`PHARMA_SALARY_TYPES = {seller, manager_trading, manager_fixed, pharmacy_manager}` — их `totalSalary` (за вычетом `totalBonuses`, но **с возвратом** `totalAdvances` обратно — потому что аванс это уже часть начисленной зарплаты, не отдельный расход) суммируется в `pharmaSalary` той аптеки, к которой привязан сотрудник. `cleaner` → `cleaning`. `office` — особый случай: его зарплата не привязана к аптеке (премия общая для всех), поэтому делится `/ activePharmacyIds.length` и добавляется каждой активной аптеке в `officeSalary`.

`pharmaBonus` (бонусы) учитывается отдельно, как обычная строка расхода из `DailyExpenseItem` — поэтому при добавлении зарплаты он вычитается из `totalSalary` (`result.totalSalary + result.totalAdvances − result.totalBonuses`), чтобы не задвоить сумму бонуса в отчёте.

## Полный список строк (`MONTHLY_REPORT_ROWS`)

Группы (`section: true`): **ВЫРУЧКА**, **ОСТАТКИ**, **РАСХОДЫ**.

| key | label | rowType | source |
|---|---|---|---|
| `retailRevenue` | ВЫРУЧКА розн в аптеке | income | db |
| `kaspiRevenue` | Выручка Каспи | — | db |
| `wholesaleRevenue` | ВЫРУЧКА опт | — | calc (`retailRevenue / coefficient`) |
| `coefficient` | коэффициент | — | db |
| `avgDailyRevenue` | Среднедневная розн выручка | — | empty (не вычисляется автоматически) |
| `terminalRent` | Аренда терминал | income | db |
| `procedureRent` | Процедурная аренда | income | db |
| `legalEntityProfit` | Прибыль по юрлицам | income | empty |
| `stockRetail` / `stockWholesale` | Остаток товара (розн/опт) | — | empty (заполняется через PDF-импорт) |
| `consignment` / `consignmentOverdue` | Консигнация / из них просрочка | — | empty |
| `goodsExpenses` … `bankServices` (24 ключа) | см. `MONTHLY_EXPENSE_KEYS` | expense | empty/db (зависит от ключа) |
| `totalExpenses` | ИТОГО РАСХОДЫ | — | calc (сумма всех expense-строк) |
| `netIncome` | Чистый доход | — | calc (сумма income − сумма expense) |
| `divideBy2` / `directorShare` | Разделить на 2 / руководителя | — | empty (ручной ввод) |

`source` — подсказка для UI ("этому полю обычно есть автоисточник" / "обычно вводится вручную"), не жёсткое ограничение: `MonthlyReportOverride` может перекрыть любое поле независимо от `source`.

## Закрытие месяца

`POST /api/months/close { year, month }` (только `admin`):

1. Проверяет, что месяц ещё не закрыт (`ClosedMonth` уникален по `[year, month]`).
2. Строит `systemData`/`overrideMap` через `computeMonthlyData()`, затем `buildMonthlySnapshot()` — резолвит каждое поле (включая calc и overrides) в плоский снимок `{pharmacyId: {fieldKey: value}}`.
3. Сохраняет снимок как JSON-строку в `ClosedMonth.snapshotJson`.

После закрытия:
- Новые записи выручки (`POST /api/revenue`) и изменения дат существующих в этот месяц автоматически получают `excludedFromReport = true` — они физически сохраняются, но не участвуют в `computeMonthlyData()` (фильтр `excludedFromReport: false`) и, соответственно, не попадают в зарплату/отчёт текущего открытого периода.
- Редактирование/удаление существующих записей этого месяца блокируется (`PUT`/`DELETE /api/revenue/[id]` вернёт 423).
- `MonthlyReportOverride` для этого месяца перестают учитываться при построении новых снимков (но снимок уже построен и неизменен).

`DELETE /api/months/close` (открыть обратно, только `admin`):

- Удаляет запись `ClosedMonth`.
- Массово возвращает `excludedFromReport = false` всем записям этого месяца, у которых он был выставлен — иначе бухгалтеру пришлось бы включать каждую запись вручную.

## Снимок vs живые данные

Закрытый месяц в UI (`/reports/monthly`) показывает данные **из снимка** (`ClosedMonth.snapshotJson`), а не пересчитывает их заново — это сознательная заморозка: если позже изменится формула зарплаты или будет добавлена новая запись расхода задним числом, отчёт уже закрытого месяца не «поплывёт».
