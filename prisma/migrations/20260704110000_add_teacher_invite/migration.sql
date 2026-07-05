-- GENUINE MIGRATION HISTORY FIX (discovered during disposable-DB pilot
-- verification, same class of gap as 20260614090000_add_exam_scheme_and_results):
-- `TeacherInvite` is a real model in schema.prisma (Teacher.invites relation)
-- but no migration in this repository's history ever creates it, even though
-- the very next migration (20260704120000_hash_invite_tokens) ALTERs it to
-- add "tokenHash". Applying the full migration chain to a fresh database
-- fails at 20260704120000_hash_invite_tokens with:
--   ERROR: relation "TeacherInvite" does not exist
--
-- Same root cause as the ExamScheme gap: evidently introduced via
-- `prisma db push` at some point with no matching migration ever generated.
--
-- Written to be SAFE to run against a database that already has this table
-- (e.g. a long-lived Neon database that had it created via `db push`) —
-- every statement is guarded to be a no-op if the object already exists.
-- On a genuinely fresh database (as tested here) it performs the real,
-- additive creation. Deliberately created WITHOUT "tokenHash" — that column
-- is added by the next migration (20260704120000_hash_invite_tokens), which
-- must remain the sole owner of that change.

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "TeacherInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (guarded)
DO $$ BEGIN
    CREATE UNIQUE INDEX "TeacherInvite_token_key" ON "TeacherInvite"("token");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- AddForeignKey (guarded)
DO $$ BEGIN
    ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
