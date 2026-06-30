# Бизнес-логика аптечного учёта: документация

Полное описание бизнес-логики и пользовательского флоу: дневная выручка, типы сотрудников, расчёт зарплаты, табель посещаемости, закрытие месяца и месячный отчёт. Структура — [Diataxis](https://diataxis.fr/): учебник для первого знакомства, гайды под конкретную задачу, справочники с точными формулами, объяснения почему так устроено.

Технический обзор стека и моделей данных для разработчика — в корневом [CLAUDE.md](../../CLAUDE.md).

## Для сотрудников аптек (без терминов)

- [guide-kak-rabotaet-sistema.md](guide-kak-rabotaet-sistema.md) — как устроена вся система целиком, простыми словами
- [guide-vyruchka-i-sotrudniki-prostymi-slovami.md](guide-vyruchka-i-sotrudniki-prostymi-slovami.md) — где и как вносить выручку, что на странице с записями, как заводить сотрудников
- [guide-zarplata-prostymi-slovami.md](guide-zarplata-prostymi-slovami.md) — как считается ваша зарплата, простыми словами, по должностям

## Туториал

- [tutorial-first-month.md](tutorial-first-month.md) — от пустой аптеки до закрытого месяца, на одном сквозном примере

## Как сделать (бухгалтер/админ)

- [howto-enter-daily-revenue.md](howto-enter-daily-revenue.md) — внести дневную выручку, аванс, подтвердить/отклонить запись
- [howto-manage-employees.md](howto-manage-employees.md) — завести и настроить сотрудника любого из 6 типов
- [howto-track-attendance.md](howto-track-attendance.md) — вести табель посещаемости
- [howto-close-month.md](howto-close-month.md) — закрыть и открыть месяц
- [howto-configure-premiums-and-calendar.md](howto-configure-premiums-and-calendar.md) — рабочий календарь, лестничная премия заведующих, диапазоны премии офиса

## Справочник

- [reference-employee-types.md](reference-employee-types.md) — все 6 `employeeType`: чем отличаются, какие поля используют
- [reference-salary-formulas.md](reference-salary-formulas.md) — точные формулы расчёта зарплаты по каждому типу
- [reference-monthly-report-fields.md](reference-monthly-report-fields.md) — откуда берётся каждое поле месячного отчёта, механика закрытия
- [reference-roles-and-access.md](reference-roles-and-access.md) — роли сессии, кто что может

## Почему так устроено

- [explanation-revenue-vs-attendance.md](explanation-revenue-vs-attendance.md) — зачем два механизма учёта смен (запись выручки vs табель)
- [explanation-salary-design.md](explanation-salary-design.md) — почему формулы зарплаты различаются между типами сотрудников
- [explanation-monthly-close-and-overrides.md](explanation-monthly-close-and-overrides.md) — зачем закрытие месяца делает снимок, а не просто блокировку

## С чего начать

Новому пользователю — [tutorial-first-month.md](tutorial-first-month.md). Если нужно решить конкретную задачу — соответствующий how-to. Если нужна точная формула или список полей — справочник. Если непонятно «зачем это так сделано» — раздел объяснений.
