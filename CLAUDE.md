# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (uses local SQLite)
npm run build        # Production build
npm run db:push      # Sync Prisma schema to local SQLite (dev only)
npm run db:studio    # Open Prisma Studio (GUI for local DB)
npm test             # Run full Vitest suite once
npm run test:watch   # Vitest in watch mode
npx vitest run src/__tests__/salary-calculator.test.ts   # Run a single test file
npx vitest run -t "subtracts advances"                   # Run tests matching a name pattern
```

Tests live in `src/__tests__/`. They mock `@/lib/prisma` directly (see `vi.mock('@/lib/prisma', ...)` at the top of each file) — no real DB is used. There is no `clearMocks`/`resetMocks` config in `vitest.config.ts`, so `mock.calls` accumulates across tests in the same file/describe block; when asserting on call args, grab the last call (`mock.calls[mock.calls.length - 1]`), not `calls[0]`.

## Architecture

**Next.js 15 App Router** with Prisma ORM. Two environments:
- **Local dev**: SQLite (`prisma/dev.db`), files saved to `uploads/` folder
- **Production (Railway)**: PostgreSQL, files stored in Cloudflare R2

### Auth & RBAC

Three roles: `admin`, `bookkeeper`, `manager`.
- **Admin / bookkeeper**: password-only login via env vars `ADMIN_PASSWORD` / `BOOKKEEPER_PASSWORD`, compared with constant-time `timingSafeEqual` in `src/app/api/auth/login/route.ts`.
- **Manager** (`заведующий`): real account in the `User` table — login by `username` + password, hash stored in `passwordHash` and checked via `verifyPassword`/`hashPassword` from `src/lib/password.ts` (scrypt + salt). A manager is scoped to specific pharmacies through `UserPharmacy` (M:N); `getManagerPharmacyIds()` in `src/lib/api-auth.ts` returns the allowed pharmacy IDs (or `null` for admin/bookkeeper = unrestricted).

JWT (`{ role, userId? }`) is stored in the `session` cookie and validated in `src/middleware.ts`, which also enforces per-role path allowlists (`BOOKKEEPER_ALLOWED`, `MANAGER_ALLOWED`) and upload size limits, then forwards `x-user-role` / `x-user-id` headers to API routes. Use `requireAdmin` / `requireAdminOrBookkeeper` / `requireAnyRole` / `requireRole` from `src/lib/api-auth.ts` to guard route handlers — never re-check roles ad hoc. Login attempts are rate-limited per IP via `src/lib/rate-limit.ts`.

### File Storage (`src/lib/storage.ts`)

Abstraction over local disk vs Cloudflare R2. Auto-detects based on env vars. Always use `uploadFile` / `downloadFile` / `deleteFile` from this module — never use `fs` directly for uploaded files.

### File Storage (`src/lib/storage.ts`)

Abstraction over local disk vs Cloudflare R2. Auto-detects based on env vars. Always use `uploadFile` / `downloadFile` / `deleteFile` from this module — never use `fs` directly for uploaded files.

### Data Model Overview

Key Prisma models and what they store:

| Model | Purpose |
|---|---|
| `Pharmacy` | Аптека: coefficient (розн→опт), terminalRent, procedureRent |
| `PharmacyAlias` | Ключевые слова для автоопределения аптеки из текста транзакции |
| `User` | Аккаунт заведующего (`role: 'manager'`): username/passwordHash; связан с аптеками через `UserPharmacy` |
| `Employee` | Сотрудник с baseSalary; связан с аптеками через `EmployeePharmacy` (M:N) |
| `DailyRevenueEntry` | Ежедневная выручка (cash + terminal + kaspi), статус pending/approved/rejected |
| `DailyExpenseItem` | Детализация расходов по записи выручки; `category` — ключ из `MONTHLY_EXPENSE_KEYS`. Имеет собственный nullable `employeeId` — получатель, который может отличаться от сотрудника самой записи (используется для `employeeAdvance`, см. ниже) |
| `UploadedFile` | Загруженный файл (bank_transactions_excel или другой тип) |
| `ExtractedExpenseEntry` | Строки из не-банковских файлов; category: `rent` → `rentExpenses`, `expense` → `bankServices` |
| `TransactionImportRule` | Правило сопоставления строк банк-выписки (sourceField, pattern, matchType, distributionType) |
| `ImportedTransaction` | Одна строка банк-выписки после загрузки |
| `ImportedReportValue` | Куда и сколько идёт из транзакции (по аптекам и fieldKey) |
| `MonthlyReportOverride` | Ручная правка одной ячейки отчёта (год, месяц, аптека, fieldKey) |
| `ClosedMonth` | Снимок (snapshotJson) всех значений на момент закрытия |
| `PharmacyPdfReport` | Данные из PDF-отчёта аптеки: остатки, наценка |

### Two File Upload Flows

**1. Bank transactions Excel** (`fileType = 'bank_transactions_excel'`):
- Разбирается через `parseBankTransactionsExcel()` → строки сохраняются как `ImportedTransaction`
- Каждая строка сопоставляется с `TransactionImportRule` → создаются `ImportedReportValue`
- Пользователь подтверждает/отклоняет на `/files/[id]`
- Подтверждённые `ImportedReportValue` суммируются в monthly report через `computeMonthlyData()`

**2. Другие файлы** (PDF-выписки и пр.):
- Загружаются через `/api/files/`, строки сохраняются как `ExtractedExpenseEntry`
- Только две категории: `rent` → `rentExpenses` в отчёте, `expense` → `bankServices`
- Отдельный approve/reject через `/api/expenses/`

### Bank Import: Matching Rules

Правило (`TransactionImportRule`) матчит по полю `sourceField`:
- `counterparty`, `bin_iin`, `purpose`, `any_text`

Типы совпадения (`matchType`): `contains`, `exact`, `regex` (текст нормализуется: lowercase, ё→е).

Типы распределения (`distributionType`):
- `specific_pharmacy` — фиксированная аптека из правила
- `detect_pharmacy_from_text` — автоопределение по `PharmacyAlias`
- `split_equally` — поровну по всем активным аптекам
- `split_custom` — произвольные суммы по выбранным аптекам (хранится в `ImportedTransaction.customDistribution` как JSON)

После изменения транзакции пользователем вызывается `regenerateImportedReportValues()` из `src/lib/bank-transaction-import.ts`.

### Monthly Report (`src/lib/monthly-report-builder.ts`)

`computeMonthlyData(year, month)` агрегирует данные из нескольких источников в один объект `systemData[pharmacyId][fieldKey]`:

1. `DailyRevenueEntry` — выручка и `DailyExpenseItem` расходы (любой ключ из `MONTHLY_EXPENSE_KEYS`; не совпавшие → `otherExpenses`)
2. Смены сотрудников → автоматически вычисляет часть `pharmaSalary`
3. `ExtractedExpenseEntry` → `rentExpenses` и `bankServices`
4. `ImportedReportValue` (статус approved) → любое expense-поле
5. `PharmacyPdfReport` → `stockRetail`, `stockWholesale`, `coefficient`
6. `MonthlyReportOverride` — перекрывает любое поле (применяется последним)

`MONTHLY_REPORT_ROWS` в `src/lib/monthly-report-fields.ts` определяет все строки отчёта. Поле `source` (`db`/`empty`/`calc`) — только подсказка; фактически любое поле может получить данные из любого источника выше.

Закрытие месяца (`POST /api/months/close`) снимает снапшот и сохраняет в `ClosedMonth.snapshotJson`. После закрытия данные замораживаются — overrides и новые записи выручки игнорируются в отчёте.

### Salary Calculation (`src/lib/salary-calculator.ts`)

`calculateEmployeeMonthlySalary()` рассчитывается из смен за месяц: базовый оклад (делится на 15 для дневной смены `day`, на 10 для суточной `full_day`) + бонусы (`pharmaBonus` из `DailyExpenseItem`, `aggregate` по `category`) − авансы (`employeeAdvance`). `totalSalary` может уйти в минус, если авансы превышают начисленное.

Авансы (`employeeAdvance`) — это `DailyExpenseItem` с собственным `employeeId`-получателем (не обязательно сотрудник записи выручки). `getEmployeeMonthlyAdvances()` возвращает их список (`AdvanceEntry[]`) для конкретного получателя. При сохранении записи выручки (`POST /api/revenue`, `PUT /api/revenue/[id]`) сервер проверяет, что получатель аванса связан с целевой аптекой через `EmployeePharmacy` — иначе 400 «Аванс можно записать только сотруднику выбранной аптеки». В UI (`/revenue/new` и редактирование на `/revenue`) выбор категории `employeeAdvance` всегда требует выбрать получателя из списка сотрудников.

## CSS Conventions

Global utility classes defined in `src/app/globals.css` — use these instead of raw Tailwind:
- `.btn-primary`, `.btn-secondary`, `.btn-success`, `.btn-danger`, `.btn-warning`
- `.input`, `.label`, `.card`
- `.th`, `.td` — table header/cell

## Key Env Vars

```
DATABASE_URL         # PostgreSQL connection string (Railway sets this automatically)
AUTH_SECRET          # JWT signing secret (min 32 chars)
ADMIN_PASSWORD       # Admin login password
BOOKKEEPER_PASSWORD  # Bookkeeper login password
R2_ENDPOINT          # https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID     # Cloudflare R2 API key
R2_SECRET_ACCESS_KEY # Cloudflare R2 secret
R2_BUCKET_NAME       # R2 bucket name
```

## Deployment

Railway auto-deploys from the `dev` branch. On each deploy:
1. Build: `npx prisma generate && npm run build`
2. Start: `npx prisma migrate deploy && npm run start`

Migration files live in `prisma/migrations/`. When changing the schema, create a new migration with `npx prisma migrate dev --name <name>` (requires local PostgreSQL or use `--create-only` to generate SQL without applying).
