# Production Database Migration Readiness (Phase 4)

**Status: no migration in this repository has been applied to Neon (or any
production/staging database) during this engagement.** This document is a
readiness assessment and a manual workflow — it does not connect to Neon,
does not embed credentials, and was not executed against production at any
point while writing it.

## 1. What was actually verified (and how)

Everything below was verified against a **disposable, localhost-only
Postgres 16 container** (`postgres:16-alpine`, bound to `127.0.0.1`, torn
down after use) — never against Neon or `.env`'s connection string.

| Check | Result |
|---|---|
| `npx prisma migrate deploy` from a blank database | All 42 migrations applied cleanly, in order, zero errors |
| `npx prisma validate` | Schema valid |
| `npx prisma generate` | Client generated successfully |
| `npm run prisma:check-drift` (`prisma migrate diff --from-config-datasource --to-schema` `--exit-code`) | **"No difference detected"** |
| `npx prisma migrate status` | "Database schema is up to date!" |
| Full migration-history scan for destructive SQL (`DROP TABLE`, `DROP COLUMN`, blind `SET NOT NULL`, `TRUNCATE`) | One match: `20260613203000_homework_academic_tracking` sets `Homework.deadlineAt` `NOT NULL` — confirmed **safe**: the same migration adds the column nullable and backfills it from `dueDate` in the two statements immediately before the `NOT NULL` line. No other migration in the 42-migration history sets a column `NOT NULL` without a preceding backfill in the same file. |
| All 5 pilot-verification suites (134 steps total) against the fully-migrated disposable DB | 134/134 passed |

### Known blind spot in the drift check

`20260709000000_job_dedup_active_unique_index` hand-authors a **partial**
unique index (`CREATE UNIQUE INDEX ... WHERE status IN (...) AND
"payloadFingerprint" IS NOT NULL`) because Prisma's schema language has no
partial-index attribute. This index has no declarative representation in
`schema.prisma`. Despite that, `prisma:check-drift` reported "No difference
detected" both with and without the index physically present — **this drift
check does not appear to diff extra indexes that aren't declared in
`schema.prisma`**. Practical consequence: if this index is ever dropped by
hand on a target database, `prisma:check-drift` will not detect the loss.
The only defense is `src/lib/jobs.ts`'s own P2002-catch fallback (which
degrades gracefully, not silently) plus this document. Re-verify the index
exists with the query in §4 whenever this migration is (re-)applied to a new
environment.

## 2. Migrations pending against Neon

**Unknown — this must be measured directly, never assumed.** No command in
this engagement has connected to Neon (by explicit instruction), so there is
no way to know which of the 42 migrations in `prisma/migrations/` Neon has
already applied. `docs/migration-release-checklist.md` (an earlier, now
superseded checklist) listed 5 migrations as "not yet applied to Neon" as of
its own Wave C snapshot; **9 more have been added since**, most recently in
this phase (`20260707000000` through `20260709000000`). Do not reuse that
old list — run step 1 of §3 against the real target before deploying.

## 3. Manual production deployment workflow (never executed by this agent)

Run this by hand, outside of any automated session, only after an explicit
human decision to deploy:

```
 1. Take a platform-level backup/branch/snapshot of the production database
    (e.g. a Neon branch) — independent of anything Prisma does.
 2. Confirm DATABASE_URL is the pooled connection string for the intended
    target (staging vs. production — verify the hostname, not just that a
    value is set).
 3. Confirm DIRECT_URL is the *unpooled* connection string for the same
    target (see prisma.config.ts — DIRECT_URL takes priority over
    DATABASE_URL for the Prisma CLI; a mismatch here silently migrates the
    wrong database).
 4. npx prisma migrate status
    — inspect exactly which migrations are pending. Stop if this list is
      not what you expect.
 5. Read the SQL of every pending migration by hand (cat
    prisma/migrations/<name>/migration.sql) — do not trust a summary,
    including this document's §1 table, for a migration created after this
    document was written.
 6. Optionally run scripts/production-migration-preflight.ts (read-only —
    see §4) against the target and review its output.
 7. npx prisma migrate deploy
 8. npx prisma migrate status
    — confirm "Database schema is up to date!"
 9. npx prisma generate
    (only needed if the deploying environment's generated client is stale)
10. curl <deployed-url>/api/health?check=readiness
    — confirm "status": "ready" or a deliberately understood "degraded"
      (see src/app/api/health/route.ts's three-state contract), never
      "not_ready".
11. Run the application's smoke tests / the relevant pilot-verify script
    against the deployed environment before declaring the release done.
```

**`vercel.json`'s `buildCommand` intentionally never runs `prisma migrate
deploy`** (only `prisma generate && next build`) — every Vercel build
(production or preview) would otherwise attempt a migration apply against
whatever `DATABASE_URL`/`DIRECT_URL` that build resolves, with no
serialization between concurrent builds. Deploys always run against
whatever schema Neon already has; step 7 below is the only place migrations
are ever applied, run by hand, once, before merging the release.

**The exact same `DIRECT_URL ?? DATABASE_URL` fallback described in §4 below
applies to the bare `npx prisma migrate deploy`/`migrate status` commands
too, not just the preflight script** — `prisma.config.ts` reads
`DIRECT_URL` first, and `dotenv/config` will silently fill it from `.env`
even when you've exported `DATABASE_URL` yourself in the same shell command.
Always export **both** `DATABASE_URL` and `DIRECT_URL` explicitly for every
migration-related command in this workflow, never just one.

Every additive migration in this repository's history (`ADD COLUMN`,
`CREATE TABLE`, loosened `NOT NULL`) is backward-compatible with the
previous application code, so a code rollback alone is sufficient if a
deploy needs to be reverted — there is no destructive migration to undo in
the normal sense. Take the platform-level backup in step 1 anyway; that is
standard practice independent of this repository's migration style.

## 4. Read-only preflight check

`scripts/production-migration-preflight.ts` (added in this phase) runs a
small set of **read-only** queries against whatever `DATABASE_URL` is set to
when it is invoked, and prints a report. It:

- Never runs `migrate deploy`, `db push`, or any DDL.
- Never embeds a connection string — it only reads `process.env.DATABASE_URL`
  at invocation time, exactly like every other script in this repository.
- Refuses to run (exits non-zero with a clear message) if it detects it
  would be pointed at a local/disposable-looking database, since its purpose
  is specifically to sanity-check a *real* target before a deploy — running
  it against a throwaway container tells you nothing you don't already know
  from `migrate status`.

Run it manually, immediately before step 7 of §3:

```
DATABASE_URL="<real pooled url>" DIRECT_URL="<real direct url>" CONFIRM_PRODUCTION_TARGET=true npx tsx scripts/production-migration-preflight.ts
```

The script does **not** read `.env` — `DATABASE_URL`/`DIRECT_URL` must be
exported explicitly in the same command, and `CONFIRM_PRODUCTION_TARGET=true`
must be set explicitly. This is a deliberate design decision made after this
script's first test run: an earlier draft resolved its connection string via
`DIRECT_URL ?? DATABASE_URL` (mirroring `prisma.config.ts`) and was tested by
exporting only `DATABASE_URL`, so `DIRECT_URL` silently fell back to `.env`'s
real Neon value via an auto-loaded `dotenv/config` — the script then ran its
read-only queries against live Neon instead of the intended local target. No
writes occurred (the queries are `SELECT`/`EXISTS`/`count()` only), but it
was real, unauthorized access to production. The script was rewritten
immediately after to remove the `.env` auto-load and require both variables
plus an explicit confirmation flag, printed back before any query runs.

It reports: current `_prisma_migrations` table contents (applied vs.
pending relative to the local `prisma/migrations/` folder), whether the
`BackgroundJob_active_dedup_key` partial index exists (see the blind-spot
note in §1), and basic row counts for a few high-traffic tables (`School`,
`Student`, `Teacher`) so an operator has a sanity baseline before and after
the deploy. It does not print connection strings, credentials, or any
row's content — counts and boolean/enum checks only.
