-- AlterTable: daily_expense_items — link a line item to a specific employee
-- (e.g. an advance can be recorded for an employee other than the entry's employee)
ALTER TABLE "daily_expense_items"
    ADD COLUMN "employee_id" INTEGER;

-- CreateIndex
CREATE INDEX "daily_expense_items_employee_id_idx" ON "daily_expense_items"("employee_id");

-- AddForeignKey
ALTER TABLE "daily_expense_items" ADD CONSTRAINT "daily_expense_items_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
