# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

Before making code changes (new features, bug fixes, refactors), briefly state what you understood the task to be and your planned approach. Wait for user confirmation before implementing. Skip this for trivial/explicitly-detailed requests.

After large changes or adding new functions that could conflict with existing logic, run the existing test suite (`npm test`) to make sure nothing broke, and add new tests covering the new functionality.

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

Three session roles: `admin`, `bookkeeper`, `manager`. Don't confuse this with `Employee.employeeType` (6 values, see below) — role controls login/page access, employeeType controls salary formula.
- **Admin / bookkeeper**: password-only login via env vars `ADMIN_PASSWORD` / `BOOKKEEPER_PASSWORD`, compared with constant-time `timingSafeEqual` in `src/app/api/auth/login/route.ts`.
- **Manager** (`заведующий`/`менеджер`): real account in the `User` table — login by `username` + password, hash stored in `passwordHash` and checked via `verifyPassword`/`hashPassword` from `src/lib/password.ts` (scrypt + salt). A manager is scoped to specific pharmacies through `UserPharmacy` (M:N); `getManagerPharmacyIds()` in `src/lib/api-auth.ts` returns the allowed pharmacy IDs (or `null` for admin/bookkeeper = unrestricted).

JWT (`{ role, userId? }`) is stored in the `session` cookie and validated in `src/middleware.ts`, which also enforces per-role path allowlists (`BOOKKEEPER_ALLOWED`, `MANAGER_ALLOWED` — both include `/attendance` and `/api/attendance`) and upload size limits, then forwards `x-user-role` / `x-user-id` headers to API routes. Use `requireAdmin` / `requireAdminOrBookkeeper` / `requireAnyRole` / `requireRole` from `src/lib/api-auth.ts` to guard route handlers — never re-check roles ad hoc. Login attempts are rate-limited per IP via `src/lib/rate-limit.ts`.

`/users` creates `User` accounts for the three `USER_LINKED_TYPES` (`src/lib/employee-types.ts`): `manager_trading`, `manager_fixed`, `pharmacy_manager`. Creating/editing one of these accounts auto-creates/syncs a linked `Employee` row (`User.employeeId`) — so for these three types, name/salary/employeeType/pharmacies are edited only on `/users`, never on `/employees`. All other employee types (`seller`, `cleaner`, `office`) are plain `Employee` rows with no login, managed on `/employees`.

### File Storage (`src/lib/storage.ts`)

Abstraction over local disk vs Cloudflare R2. Auto-detects based on env vars. Always use `uploadFile` / `downloadFile` / `deleteFile` from this module — never use `fs` directly for uploaded files.

### Data Model Overview

Key Prisma models and what they store:

| Model | Purpose |
|---|---|
| `Pharmacy` | Аптека: coefficient (розн→опт), terminalRent, procedureRent; плюс параметры премии заведующих/менеджеров этой аптеки — managerAllowance (фикс. доплата) и managerPremiumThreshold/Base/StepAmount/StepBonus (лестница от выручки) |
| `PharmacyAlias` | Ключевые слова для автоопределения аптеки из текста транзакции |
| `User` | Аккаунт заведующего/менеджера (`role: 'manager'`): username/passwordHash; связан с аптеками через `UserPharmacy`; `employeeId` — связанная карточка `Employee` (см. Auth & RBAC) |
| `Employee` | Сотрудник с baseSalary, `employeeType` (формула зарплаты, см. ниже), `shiftRate` (только cleaner), `managerPremiumEnabled` (только pharmacy_manager); связан с аптеками через `EmployeePharmacy` (M:N) |
| `DailyRevenueEntry` | Ежедневная выручка (cash + terminal + kaspi) по сменам `day`/`full_day`/`five_day`, статус pending/approved/rejected |
| `DailyExpenseItem` | Детализация расходов по записи выручки; `category` — ключ из `MONTHLY_EXPENSE_KEYS`. Имеет собственный nullable `employeeId` — получатель, который может отличаться от сотрудника самой записи (используется для `employeeAdvance`, см. ниже) |
| `AttendanceShift` | Отметка одной отработанной смены в табеле посещаемости (employeeId + date, опционально pharmacyId) — для типов из `ATTENDANCE_BASED_TYPES`, у которых смена не привязана к записи выручки |
| `WorkingCalendar` | Кол-во рабочих дней по (год, месяц) — делитель оклада для пятидневной смены (`five_day` / табельных типов) |
| `OfficePremiumSettings` | Синглтон: глобальная лестница премии офисных сотрудников от суммарной выручки всех аптек |
| `UploadedFile` | Загруженный файл (bank_transactions_excel или другой тип) |
| `ExtractedExpenseEntry` | Строки из не-банковских файлов; category: `rent` → `rentExpenses`, `expense` → `bankServices` |
| `TransactionImportRule` | Правило сопоставления строк банк-выписки (sourceField, pattern, matchType, distributionType) |
| `ImportedTransaction` | Одна строка банк-выписки после загрузки |
| `ImportedReportValue` | Куда и сколько идёт из транзакции (по аптекам и fieldKey) |
| `MonthlyReportOverride` | Ручная правка одной ячейки отчёта (год, месяц, аптека, fieldKey) |
| `MonthlyFieldConfig` | Тип строки отчёта (income/expense/neutral) по fieldKey — используется `monthlyFieldType()` |
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
2. Смены сотрудников (`day`/`full_day`) → автоматически вычисляет часть `pharmaSalary` (только для сменных типов — seller/manager_trading; зарплата manager_fixed/cleaner/office/pharmacy_manager в отчёт не попадает, она считается отдельно через `salary-calculator.ts`)
3. `ExtractedExpenseEntry` → `rentExpenses` и `bankServices`
4. `ImportedReportValue` (статус approved) → любое expense-поле
5. `PharmacyPdfReport` → `stockRetail`, `stockWholesale`, `coefficient`
6. `MonthlyReportOverride` — перекрывает любое поле (применяется последним)

`MONTHLY_REPORT_ROWS` в `src/lib/monthly-report-fields.ts` определяет все строки отчёта. Поле `source` (`db`/`empty`/`calc`) — только подсказка; фактически любое поле может получить данные из любого источника выше.

Закрытие месяца (`POST /api/months/close`) снимает снапшот и сохраняет в `ClosedMonth.snapshotJson`. После закрытия данные замораживаются — overrides и новые записи выручки игнорируются в отчёте.

### Employee Types & Salary Calculation (`src/lib/salary-calculator.ts`)

`Employee.employeeType` (`src/lib/employee-types.ts`) selects the salary formula in `calculateEmployeeMonthlySalary(employeeId, month, year, pharmacyId?)`:

| employeeType | Source of "shifts" | Formula |
|---|---|---|
| `seller` | `DailyRevenueEntry.shiftType` (`day`/`full_day`) | baseSalary/15 per `day` + baseSalary/10 per `full_day` + `pharmaBonus` items + revenuePremium (1.5% of revenue over a 200k/300k-per-shift threshold) − advances |
| `manager_trading` | same as seller, shift `day`/`full_day` | same shift-based base pay as seller, but **no** revenuePremium — instead: 10% of the managed pharmacy's `pharmaBonus` total (`MANAGER_BONUS_SHARE_PERCENT`) + per-pharmacy `managerAllowance` + per-pharmacy ladder premium (see below) − advances |
| `manager_fixed` | `AttendanceShift` (табель) | baseSalary / `WorkingCalendar.workingDays` × attendance count + 10% bonus share + managerAllowance + ladder premium − advances |
| `cleaner` | `AttendanceShift` | `shiftRate` × attendance count − advances (no baseSalary involved) |
| `office` | `AttendanceShift` | baseSalary / workingDays × attendance count + global office ladder premium (`OfficePremiumSettings`, from total revenue of **all** pharmacies) − advances |
| `pharmacy_manager` | `AttendanceShift` | baseSalary / workingDays × attendance count + optional per-pharmacy ladder premium (only if `managerPremiumEnabled`) − advances. No bonus share, no managerAllowance |

"Ladder premium" (`computeLadderPremium`): if revenue ≥ `threshold`, pay `base`, then add one `stepBonus` for each full `stepAmount` of revenue above the threshold. Each pharmacy has its own threshold/base/step on the `Pharmacy` model; office uses the single global `OfficePremiumSettings` row instead.

Only `status: 'approved'` records count. `totalSalary` can go negative if advances exceed earnings. `ATTENDANCE_BASED_TYPES` (`manager_fixed`, `cleaner`, `office`, `pharmacy_manager`) get their shift count from `AttendanceShift`, not from revenue entries — see Attendance Tracking below. `USER_LINKED_TYPES` (`manager_trading`, `manager_fixed`, `pharmacy_manager`) are included in `calculateAllEmployeesSalaries()` even with zero records, since their allowance/premium accrues regardless of personal shifts.

Авансы (`employeeAdvance`) — это `DailyExpenseItem` с собственным `employeeId`-получателем (не обязательно сотрудник записи выручки). `getEmployeeMonthlyAdvances()` возвращает их список (`AdvanceEntry[]`) для конкретного получателя. При сохранении записи выручки (`POST /api/revenue`, `PUT /api/revenue/[id]`) сервер проверяет, что получатель аванса связан с целевой аптекой через `EmployeePharmacy` — иначе 400 «Аванс можно записать только сотруднику выбранной аптеки». В UI (`/revenue/new` и редактирование на `/revenue`) выбор категории `employeeAdvance` всегда требует выбрать получателя из списка сотрудников.

### Attendance Tracking (`/attendance`, `src/app/api/attendance/`)

For `ATTENDANCE_BASED_TYPES` (`manager_fixed`, `cleaner`, `office`, `pharmacy_manager`), whose pay isn't tied to a `DailyRevenueEntry` shift, each worked day is marked as one `AttendanceShift` row (unique on `employeeId` + `date`; `pharmacyId` optional — empty for office). Managers can only POST attendance for their own pharmacies (`getManagerPharmacyIds`); GET is scoped the same way. `getEmployeeMonthlyAttendance()` reads these for salary calculation.

### Office Premium (`/settings/office-premium`, `src/app/api/office-premium-settings/`)

Single global ladder (`OfficePremiumSettings`, one row, admin-only `PUT`) applied to all `office`-type employees against the combined revenue of every pharmacy for the month — see ladder premium formula above.

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

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
