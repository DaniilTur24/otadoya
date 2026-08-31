/*
  Warnings:

  - You are about to drop the `employee_overtime` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "employee_overtime" DROP CONSTRAINT "employee_overtime_employee_id_fkey";

-- AlterTable
ALTER TABLE "attendance_shifts" ADD COLUMN     "overtime_hours" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "employee_overtime";
