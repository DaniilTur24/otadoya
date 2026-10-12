-- Строка расхода записи выручки может быть «за другую аптеку»: деньги уходят из кассы аптеки
-- записи, а в месячном отчёте расход числится за аптекой allocated_pharmacy_id. NULL — как раньше.
ALTER TABLE "daily_expense_items" ADD COLUMN "allocated_pharmacy_id" INTEGER;
CREATE INDEX "daily_expense_items_allocated_pharmacy_id_idx" ON "daily_expense_items"("allocated_pharmacy_id");
ALTER TABLE "daily_expense_items" ADD CONSTRAINT "daily_expense_items_allocated_pharmacy_id_fkey"
  FOREIGN KEY ("allocated_pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
