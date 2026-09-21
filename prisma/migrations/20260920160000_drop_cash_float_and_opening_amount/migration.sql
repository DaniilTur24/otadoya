-- Отказ от сальдо: норма размена и стартовая сумма больше не нужны.
-- Касса считается с нуля от месяца в cash_opening_date и копится по дням.
ALTER TABLE "pharmacies" DROP COLUMN IF EXISTS "cash_float_norm";
ALTER TABLE "pharmacies" DROP COLUMN IF EXISTS "cash_opening_amount";
