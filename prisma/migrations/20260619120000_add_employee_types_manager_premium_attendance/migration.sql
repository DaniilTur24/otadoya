-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "employee_type" TEXT NOT NULL DEFAULT 'seller',
ADD COLUMN     "shift_rate" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "manager_allowance" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "manager_premium_base" DECIMAL(65,30),
ADD COLUMN     "manager_premium_step_amount" DECIMAL(65,30),
ADD COLUMN     "manager_premium_step_bonus" DECIMAL(65,30),
ADD COLUMN     "manager_premium_threshold" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employee_id" INTEGER;

-- CreateTable
CREATE TABLE "attendance_shifts" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_premium_settings" (
    "id" SERIAL NOT NULL,
    "threshold" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "base" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "step_amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "step_bonus" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_premium_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_shifts_pharmacy_id_idx" ON "attendance_shifts"("pharmacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_shifts_employee_id_date_key" ON "attendance_shifts"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_shifts" ADD CONSTRAINT "attendance_shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_shifts" ADD CONSTRAINT "attendance_shifts_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

