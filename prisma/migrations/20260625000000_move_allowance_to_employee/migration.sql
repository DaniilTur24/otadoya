-- AlterTable
ALTER TABLE "pharmacies" DROP COLUMN "manager_allowance";

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "allowance" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "allowance_description" TEXT NOT NULL DEFAULT '';
