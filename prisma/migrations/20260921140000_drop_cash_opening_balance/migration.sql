-- Миграция 20260921130000_add_cash_opening_balance была применена на staging, а затем
-- откачена в коде (фича "остаток кассы на начало учёта" отменена до релиза) — откат в git
-- не откатывает базу: на staging осталась колонка pharmacies.cash_opening_balance и запись
-- в _prisma_migrations, которой нет в prisma/migrations/. `migrate deploy` это терпит, а
-- `migrate dev` видит drift (тот же сценарий, что и в 20260917120100).
-- IF EXISTS / DELETE по имени — на production та миграция не применялась вовсе (сервис
-- otadoya деплоится из dev, а не из feature), тогда шаги ничего не делают и это не ошибка.
ALTER TABLE "pharmacies" DROP COLUMN IF EXISTS "cash_opening_balance";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260921130000_add_cash_opening_balance';
