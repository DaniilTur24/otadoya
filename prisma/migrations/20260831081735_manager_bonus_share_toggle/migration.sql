-- Заведующие/менеджеры получают два независимых переключателя (лестничная премия
-- аптеки и 10% от бонусов), вместо того чтобы поведение было жёстко зашито в
-- employeeType. Бэкфилл ниже сохраняет текущие фактические начисления без изменений:
--   - manager_fixed:      лестница и 10% были включены всегда безусловно -> true/true
--   - manager_trading:    10% были включены всегда безусловно -> true (лестница уже
--                         управлялась существующим ladder_premium_enabled, не трогаем)
--   - pharmacy_manager:   10% не было никогда -> false; лестница переносится из
--                         старого manager_premium_enabled в общий ladder_premium_enabled

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "manager_bonus_share_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "employees" SET "ladder_premium_enabled" = true WHERE "employee_type" = 'manager_fixed';

UPDATE "employees" SET "ladder_premium_enabled" = "manager_premium_enabled" WHERE "employee_type" = 'pharmacy_manager';

UPDATE "employees" SET "manager_bonus_share_enabled" = false WHERE "employee_type" = 'pharmacy_manager';

ALTER TABLE "employees" DROP COLUMN "manager_premium_enabled";
