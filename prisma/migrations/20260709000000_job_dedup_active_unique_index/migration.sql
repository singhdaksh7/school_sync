-- Phase 4 concurrency closure (PART 11): a DB-level backstop against two
-- concurrent identical requests creating duplicate ACTIVE background jobs.
-- Hand-authored (not `prisma migrate dev`-generated) because Prisma's schema
-- language has no partial-index attribute — this is a deliberate, documented
-- exception to "migrations are auto-generated from schema.prisma".
--
-- Only PENDING/RUNNING rows with a non-null payloadFingerprint participate:
-- a COMPLETED/FAILED job is never blocked from having a later legitimate
-- equivalent job created (matches the existing findExistingEquivalentJob
-- application-level semantics in src/lib/job-dedup.ts exactly — this index
-- only closes the race, it does not change the dedup *rule*).
CREATE UNIQUE INDEX "BackgroundJob_active_dedup_key"
  ON "BackgroundJob" ("schoolId", "type", "payloadFingerprint")
  WHERE "status" IN ('PENDING', 'RUNNING') AND "payloadFingerprint" IS NOT NULL;
