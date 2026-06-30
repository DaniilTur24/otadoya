# Справочник: роли и доступ

Источник истины: [`src/lib/api-auth.ts`](../../src/lib/api-auth.ts), [`src/middleware.ts`](../../src/middleware.ts).

## Три роли сессии

| Роль | Кто | Логин | Доступ |
|---|---|---|---|
| `admin` | администратор | пароль из `ADMIN_PASSWORD` | без ограничений |
| `bookkeeper` | бухгалтер | пароль из `BOOKKEEPER_PASSWORD` | см. `BOOKKEEPER_ALLOWED` ниже |
| `manager` | заведующая/менеджер аптеки | `username` + пароль, аккаунт в таблице `User` | см. `MANAGER_ALLOWED` ниже, плюс ограничение по своим аптекам |

Admin/bookkeeper входят по паролю из переменных окружения (`timingSafeEqual`-сравнение). Manager — реальный аккаунт `User`, пароль — scrypt-хэш (`src/lib/password.ts`), привязан к аптекам через `UserPharmacy` (M:N).

JWT (`{role, userId?}`) лежит в cookie `session`, middleware прокидывает его как заголовки `x-user-role`/`x-user-id` в API-роуты. `getRequestRole()`/`getRequestUserId()` читают эти заголовки. `requireAdmin`/`requireAdminOrBookkeeper`/`requireAnyRole`/`requireRole` — guard-функции для роутов.

## Разрешённые пути (middleware.ts)

```
BOOKKEEPER_ALLOWED = /revenue, /revenue/new, /employees, /users, /attendance,
                     /api/revenue, /api/employees, /api/pharmacies, /api/users,
                     /api/months/close, /api/attendance

MANAGER_ALLOWED    = /revenue, /revenue/new, /attendance,
                     /api/revenue, /api/employees, /api/pharmacies,
                     /api/months/close, /api/attendance
```

Запрос вне allowlist: API → 403, страница → редирект на `/revenue/new`. Bookkeeper не имеет доступа к `/reports/monthly`, `/settings/*`, `/files` — это зона `admin`.

## `getManagerPharmacyIds(request)`

Возвращает список `pharmacyId`, доступных текущему пользователю:
- `admin`/`bookkeeper` → `null` (= без ограничений, видит всё)
- `manager` → список аптек из `UserPharmacy` (может быть пустым, если не привязан ни к одной)

Используется во всех местах, где manager должен видеть/писать только свои аптеки: `GET/POST /api/revenue`, `GET/POST /api/attendance`, `GET /api/employees`.

## Конкретные правила по эндпоинтам

| Действие | Кто может |
|---|---|
| Создать запись выручки (`POST /api/revenue`) | любая роль; у `manager` статус сразу `pending`, у `admin`/`bookkeeper` — сразу `approved` |
| Редактировать/удалить запись выручки | `admin`/`bookkeeper` — любую; `manager` — только свою (`submittedById === userId`) и только в статусе `pending` |
| Подтвердить/отклонить запись (`/api/revenue/[id]/approve|reject`) | только `admin`/`bookkeeper` |
| Отметить/снять табель (`/api/attendance`) | любая роль; `manager` — только по своим аптекам |
| Создать/редактировать сотрудника (`/api/employees`) | только `admin` (создание и `PUT`); `GET` — любая роль с фильтром по аптекам для manager |
| Создать/редактировать аккаунт заведующего (`/api/users`) | `admin`/`bookkeeper` |
| Расчёт зарплаты (`/api/employees/[id]/salary`, `salary-summary`) | только `admin`/`bookkeeper` |
| Закрыть/открыть месяц (`/api/months/close`) | только `admin` |
| Месячный отчёт (`/api/reports/monthly`) | только `admin` |

## Загрузки файлов

Лимиты размера (`middleware.ts`): Excel-выписки до 10 МБ, PDF — до 15 МБ. Проверяется на уровне middleware до того, как запрос дойдёт до API-роута.
