-- AlterTable
ALTER TABLE "School" ADD COLUMN     "creationIdempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "enabledFeatures" "FeatureFlagKey"[] DEFAULT ARRAY[]::"FeatureFlagKey"[],
ADD COLUMN     "priceAnnualMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceMonthlyMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staffLimit" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "School_creationIdempotencyKey_key" ON "School"("creationIdempotencyKey");

-- Backfill: derive the new integer-minor-unit prices from the existing
-- decimal columns for any plan rows that already exist (safe no-op on a
-- fresh/empty table, which is the common case this ticket's bug describes).
UPDATE "SubscriptionPlan"
SET "priceMonthlyMinor" = ROUND("priceMonthly" * 100)::INTEGER,
    "priceAnnualMinor" = ROUND("priceAnnual" * 100)::INTEGER;

-- Idempotent, application-owned baseline plan catalogue bootstrap (never a
-- manual seed command — see ticket requirement). ON CONFLICT (slug) DO
-- NOTHING means this is safe to ship in every environment: it only ever
-- inserts the three baseline plans on their very first appearance and never
-- touches a plan a Founder has since edited or deactivated. Slug 'trial'
-- intentionally matches the existing isTrial check in
-- src/app/api/founder/invites/route.ts.
INSERT INTO "SubscriptionPlan"
  ("id", "name", "slug", "description", "currency", "priceMonthly", "priceAnnual", "priceMonthlyMinor", "priceAnnualMinor", "maxStudents", "staffLimit", "enabledFeatures", "isActive", "createdAt", "updatedAt")
VALUES
  ('plan_seed_trial_v1', 'Trial', 'trial', '30-day free trial with core modules.', 'INR', 0, 0, 0, 0, 50, 10, ARRAY['ATTENDANCE','HOMEWORK','REPORT_CARDS']::"FeatureFlagKey"[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_seed_basic_v1', 'Basic', 'basic', 'For a single school getting started.', 'INR', 999.00, 9999.00, 99900, 999900, 300, 30, ARRAY['ATTENDANCE','HOMEWORK','FEES','REPORT_CARDS','NOTIFICATIONS']::"FeatureFlagKey"[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_seed_premium_v1', 'Premium', 'premium', 'Full feature set, no student/staff cap.', 'INR', 2999.00, 29999.00, 299900, 2999900, NULL, NULL, ARRAY['ATTENDANCE','HOMEWORK','FEES','REPORT_CARDS','REPORT_CARD_BUILDER','NOTIFICATIONS','ANALYTICS','PARENT_PORTAL','STUDENT_PORTAL','MOBILE_APP']::"FeatureFlagKey"[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
