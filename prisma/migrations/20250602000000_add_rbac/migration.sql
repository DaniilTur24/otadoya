-- CreateTable: users (managers only; admin/bookkeeper stay as env vars)
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateTable: user_pharmacies (manager <-> pharmacy M:N)
CREATE TABLE "user_pharmacies" (
    "user_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,

    CONSTRAINT "user_pharmacies_pkey" PRIMARY KEY ("user_id","pharmacy_id")
);

-- CreateTable: employee_pharmacies (employee <-> pharmacy M:N)
CREATE TABLE "employee_pharmacies" (
    "employee_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,

    CONSTRAINT "employee_pharmacies_pkey" PRIMARY KEY ("employee_id","pharmacy_id")
);

-- AlterTable: daily_revenue_entries — audit fields
ALTER TABLE "daily_revenue_entries"
    ADD COLUMN "submitted_by_id" INTEGER,
    ADD COLUMN "approved_by_id" INTEGER,
    ADD COLUMN "approved_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "daily_revenue_entries_submitted_by_id_idx" ON "daily_revenue_entries"("submitted_by_id");

-- AddForeignKey
ALTER TABLE "user_pharmacies" ADD CONSTRAINT "user_pharmacies_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_pharmacies" ADD CONSTRAINT "user_pharmacies_pharmacy_id_fkey"
    FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_pharmacies" ADD CONSTRAINT "employee_pharmacies_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_pharmacies" ADD CONSTRAINT "employee_pharmacies_pharmacy_id_fkey"
    FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_revenue_entries" ADD CONSTRAINT "daily_revenue_entries_submitted_by_id_fkey"
    FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_revenue_entries" ADD CONSTRAINT "daily_revenue_entries_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
