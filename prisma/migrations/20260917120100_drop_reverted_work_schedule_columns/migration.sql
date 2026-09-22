-- Миграция 20260901125337_employee_work_schedule («смешанные графики», коммит 7aefe41) была
-- применена на staging, а затем откачена в коде (3b7e096) — но откат в git не откатывает базу:
-- на staging остались колонки employees.five_day_salary / work_schedule и запись в
-- _prisma_migrations, которой нет в prisma/migrations/. `migrate deploy` это терпит, а
-- `migrate dev` видит drift и предлагает СБРОСИТЬ базу (QA раунд 4, №15).
-- Здесь доделываем откат. IF EXISTS / DELETE по имени — на production та миграция могла не
-- применяться вовсе, тогда шаги ничего не делают и это не ошибка. Данных в колонках быть не должно
-- (функция откачена до использования; на staging проверено — 0 непустых значений).
ALTER TABLE "employees" DROP COLUMN IF EXISTS "five_day_salary";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "work_schedule";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260901125337_employee_work_schedule';
