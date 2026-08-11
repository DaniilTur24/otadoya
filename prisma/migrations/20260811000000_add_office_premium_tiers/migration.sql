-- office_premium_settings (single-row threshold/base/step model) was replaced by
-- office_premium_tiers (arbitrary revenue-range table) in code, but no migration ever
-- created office_premium_tiers or dropped the now-unused office_premium_settings table.
-- This fixes the drift: prod never had office_premium_tiers, so every salary calculation
-- for an `office` employee fails with Prisma P2021 (table does not exist).

-- IF EXISTS/IF NOT EXISTS on purpose: production already has office_premium_tiers
-- (created out-of-band via `db push`) and no longer has office_premium_settings, while
-- a from-scratch `migrate deploy` would produce the opposite. This reconciles both.

-- DropTable
DROP TABLE IF EXISTS "office_premium_settings";

-- CreateTable
CREATE TABLE IF NOT EXISTS "office_premium_tiers" (
    "id" SERIAL NOT NULL,
    "from_amount" DECIMAL(65,30) NOT NULL,
    "to_amount" DECIMAL(65,30),
    "bonus_amount" DECIMAL(65,30) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_premium_tiers_pkey" PRIMARY KEY ("id")
);
