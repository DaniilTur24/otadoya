-- Правка остатка по пересчёту убрана: расчётная касса больше не равна содержимому ящика
-- (она считается с нуля от месяца старта), поэтому сверять её с пересчётом нельзя.
-- Остался единственный вид движения — взнос в банк, и поле kind стало лишним.
DROP INDEX IF EXISTS "cash_movements_pharmacy_id_date_kind_key";
ALTER TABLE "cash_movements" DROP COLUMN IF EXISTS "kind";
CREATE UNIQUE INDEX "cash_movements_pharmacy_id_date_key" ON "cash_movements"("pharmacy_id", "date");
