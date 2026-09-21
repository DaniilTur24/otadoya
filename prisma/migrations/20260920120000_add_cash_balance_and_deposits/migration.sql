-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "cash_float_norm" DECIMAL(65,30),
ADD COLUMN     "cash_opening_amount" DECIMAL(65,30),
ADD COLUMN     "cash_opening_date" DATE;

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_movements_pharmacy_id_date_idx" ON "cash_movements"("pharmacy_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_pharmacy_id_date_kind_key" ON "cash_movements"("pharmacy_id", "date", "kind");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
