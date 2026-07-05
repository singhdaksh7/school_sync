# Cost Guard & Session Hardening — Architecture

Security + resource control + cost control + session hardening for
SchoolSync's mobile/API surface. No AI, no invasive device fingerprinting,
no changes to NextAuth's session architecture.

## Goals

Reduce unnecessary API traffic, protect against buggy/scripted clients,
prevent excessive authentication attempts without letting one bad actor
block an entire school's shared IP, reduce repeated session creation,
control high-cost endpoints/uploads/downloads, and auto-expire temporary
managed files — while never degrading the experience of a legitimate user.

## Successful-login vs. app-open semantics

**Counts as a login**: a credential (password) verification that issues a
new `AuthSession` row — i.e. a call to `/api/mobile/login`,
`/api/mobile/staff/login`, `/api/mobile/student/login`, `/api/parent/login`,
or the web NextAuth credential providers that succeeds.

**Does NOT count**: opening the app, calling `/api/mobile/me`, any normal
authenticated request, the app resuming from background, or the
session-touch/idle-refresh that happens automatically on activity. None of
these ever create an `AuthLoginEvent` row or a new `AuthSession` — they only
read/validate the existing one.

## Unified parent/student login

`POST /api/mobile/login` (`src/lib/unified-mobile-login.ts`) resolves the
school (white-label hostname → explicit `schoolSlug`), normalizes the
credential, checks the account-scoped failure lock, then evaluates it
against BOTH a candidate guardian (phone) and candidate student
(admissionNo) in the same school. If both verify, the request **fails
closed** — a generic `INVALID_CREDENTIALS` response, with the actual
conflict logged only server-side (never surfaced to the caller). Existing
`/api/parent/login`, `/api/mobile/student/login`, and `/api/mobile/staff/login`
routes are preserved unchanged in their request/response shape and were
extended internally to share the same throttle/quota/session services.

## Session model

`AuthSession` (see schema) is the server-side counterpart to a mobile/parent
JWT's `sid` claim — a random UUID generated at login, embedded in the token,
and stored here only as a SHA-256 hash (`sessionTokenHash`). The raw token is
never stored. `deviceInstallationId` is an app-generated UUID the client
supplies (or omits — every device-limit/rotation check degrades gracefully
to "no device correlation" when absent, never breaking existing clients that
don't send one yet). No IMEI/advertising ID/MAC address is ever collected.

Fields: `actorType`, `userId`/`teacherId`/`guardianId`/`studentId` (plain
scalar identity columns, not Prisma relations — this is high-write
tracking state, not a core domain entity), `createdAt`, `lastSeenAt`,
`expiresAt` (absolute), `idleExpiresAt` (rolling), `revokedAt`/`revokeReason`.

**Web NextAuth sessions are untouched** — they remain the existing stateless
JWT-cookie strategy. Owner/Admin/VP/Teacher web logins get failure-lock and
successful-login-quota tracking (added directly inside the existing
`authorize()` callbacks) but NO `AuthSession` row, because a web JWT cookie
has no bearer token to revoke — creating one would only pollute the mobile
device-limit count with sessions the web flow never validates.

## Session lifetimes (PART 8)

| Actor | Absolute | Idle |
|---|---|---|
| Parent / Student | 30 days | 14 days |
| Teacher | 14 days | 7 days |
| Admin staff (mobile) | 14 days | 7 days |

`lastSeenAt`/`idleExpiresAt` are only persisted if the previous value is
older than `SESSION_TOUCH_INTERVAL_MS` (15 minutes) — not on every request.

## Login quotas (PART 4)

Rolling 24h window, durable (`AuthLoginEvent`, PostgreSQL — not Redis, so a
cache outage never removes this control). Checked AFTER password
verification succeeds but BEFORE the new session is created, so a
quota-exhausted account can still be brute-forced no further than the
failure-lock already allows, and an EXISTING session is never affected by a
later quota rejection.

| Actor | Limit |
|---|---|
| Parent | 3 / 24h |
| Student | 3 / 24h |
| Teacher | 6 / 24h |
| Admin staff | 8 / 24h |

## Failed-password escalation (PART 5)

Atomic (`INSERT ... ON CONFLICT DO UPDATE`, one statement, application-passed
`now` for full testability), bucketed by `sha256(schoolId:authFlow:normalized
identifier)` — never keyed on confirmed account existence, so no enumeration
signal.

| Attempt | Parent/Student | Teacher |
|---|---|---|
| 1-2 | normal | normal |
| 3 | 1 min cooldown | 1 min cooldown |
| 4 | 15 min cooldown | 10 min cooldown |
| 5+ | 6 hour lock | 1 hour lock |

A successful login resets the bucket. A lock is checked BEFORE bcrypt runs
(no wasted verification while locked) and is never bypassed by another
existing session's API activity.

## Active session / device limits (PART 7)

| Actor | Max |
|---|---|
| Student | 2 |
| Parent | 3 |
| Teacher | 3 |
| Admin staff | none (product decision — no revocable web session architecture to key it against) |

A new login beyond the limit revokes the OLDEST active session
(`revokeReason: ACTIVE_SESSION_LIMIT`) then creates the new one. A login from
the SAME `deviceInstallationId` with an existing active session ROTATES that
session in place (fresh token hash + refreshed expiry) instead of counting
as a new device — proven directly in the pilot run.

## Authentication throttle keys (PART 10/11)

Primary: `sha256(schoolId + authFlow + normalizedIdentifier)` — scoped to
the target account, never primarily to IP, so one student's failed
attempts can never lock out an entire school's shared Wi-Fi/NAT. Secondary:
`AUTH_IP_POLICY` (200 attempts / 15 min / IP) on every auth entry point,
tolerant of a whole school behind one address.

## API cost categories (PART 9)

| Category | Limit | Scope |
|---|---|---|
| STANDARD_READ | 60/min | actor |
| EXPENSIVE_READ | 10/min | actor |
| MUTATION | 20/min | actor |
| UPLOAD (global) | 10/hour | actor |
| DOWNLOAD | 20/hour | actor |
| PDF | 15/hour | actor |
| JOB_CREATE | 5/hour | actor |
| JOB_STATUS | 60/min | actor |
| AI_ACTOR | 10/hour | actor |
| AI_SCHOOL | 50/day | school |

All keyed `schoolId:actorType:actorId:category` (`src/lib/api-cost-guard.ts`)
— never primarily by IP for authenticated requests. Wired into Smart
Timetable (recommendations/validate/quality/generate/publish), report-card
generation, `/api/schools/[schoolId]/analytics`, `/api/ai-insights`, and
`/api/files/[fileId]` as the representative set for this phase; the same
`enforceActorRateLimit`/`enforceSchoolRateLimit` helpers are the pattern for
extending coverage to further routes.

## Job deduplication (PART 13)

`src/lib/job-dedup.ts` computes a stable SHA-256 fingerprint of a job's
normalized payload (object keys sorted recursively; array order preserved,
since section/list order is semantically meaningful) and looks for an
existing PENDING/RUNNING `BackgroundJob` with the same
`(schoolId, type, payloadFingerprint)` before creating a new one — wired into
`SMART_TIMETABLE_GENERATION` (generate-batch) and
`REPORT_CARD_BATCH_GENERATION` (student-id-order-independent). A COMPLETED/
FAILED job never blocks a new equivalent request.

## Upload quotas (PART 24)

Global (10/hour/actor) AND a category ceiling both apply (stricter wins):

| Category | Limit |
|---|---|
| Homework teacher attachment | 20/day |
| Homework submission | 10/day |
| SaaS payment proof | 5/day |
| Report-card/template asset | 20/day |
| Branding image | 10/day |
| Student import source | 5/day |

Distributed-safe (same `rateLimit()` backend as everything else), never an
in-memory counter, never keyed by raw PII.

## File retention (PART 17-19)

The server ALWAYS derives `expiresAt` (`src/lib/file-retention.ts`) — a
client can never supply it.

| Category | Policy | Expiry |
|---|---|---|
| Homework teacher attachment | EXPIRING | due date + 7 days |
| Homework submission | EXPIRING | due date + 30 days |
| Student import source | EXPIRING | terminal job completion + 3 days (success) / 7 days (failure) |
| SaaS payment proof | LONG_TERM | never |
| Report-card asset | REFERENCE_MANAGED | never (age-based) |
| Branding image | REFERENCE_MANAGED | never (age-based) |

Deleting the attachment NEVER deletes the owning `Homework`/`HomeworkSubmission`
row — title/description/status/score/remarks are untouched.
`resolveManagedOrLegacyFileUrl` was fixed so a logically-deleted managed file
never falls back to a stale legacy URL (a managed reference is authoritative
once it exists).

## Cleanup worker (PART 20)

`FILE_RETENTION_CLEANUP` job type, bounded batch (100 rows,
`expiresAt <= now AND deletedAt IS NULL AND retentionPolicy = EXPIRING`,
ordered by `expiresAt`). Deletion is idempotent by provider contract (S3's
`DeleteObject` and the in-memory provider's `Map.delete` are both no-ops on
an already-missing key, not errors) — an already-missing object is a
cleanable success, a THROWN error (transient storage failure) leaves the row
un-deleted for the next run. One `BackgroundJob` row processes the whole
batch, not one row per file.

## Maintenance trigger (PART 21)

`ensureFileRetentionCleanupJob()` (`src/lib/file-retention.ts`) is called by
either `POST /api/internal/maintenance/file-retention` (secret-authenticated,
same pattern as the existing internal worker route) or
`npm run maintenance:file-retention` (CLI). Both are dedup-safe — calling
either twice in the same day never creates a second active cleanup job.
Deployment contract: trigger once daily via whatever scheduler the
production environment uses (out of scope for this phase — no AWS/cron
configuration is made here).

## S3 lifecycle safety net (PART 22)

The application retention worker is authoritative (expiry depends on
homework due dates, job completion, and references — none of which S3
itself knows). A bucket lifecycle rule is only a safety net for orphans and
must never be a blanket age-based policy — payment proofs and report-card
assets must NEVER be lifecycle-deleted by object age. Existing storage key
prefixes already group by category (`generateStorageKey`), so a future
lifecycle rule could safely target only the `STUDENT_IMPORT_SOURCE` prefix
as an extra orphan safety net, since that category is already
short-lived-by-design.

## Rate limiter fail behavior (PART 33)

- Standard API (STANDARD_READ/EXPENSIVE_READ/MUTATION/UPLOAD/DOWNLOAD/PDF):
  fails OPEN on a distributed-backend outage (existing `rateLimit()`
  behavior, unchanged) — availability over strictness for normal school
  operations.
- Authentication failure-lock: PostgreSQL-backed, not Redis — a cache
  outage can never remove account throttling.
- AI (`AI_ACTOR`/`AI_SCHOOL`): still uses the same fail-open `rateLimit()`
  path today (not overridden to fail-closed in this phase) — documented as
  a LATER SCALE risk if AI volume/cost ever demands stricter guarantees.

## Known limitations

- Only a representative set of routes got explicit rate-limit wiring this
  phase (Smart Timetable, report cards, analytics, AI, files, uploads) — the
  `enforceActorRateLimit`/`enforceUploadQuota` helpers are the pattern for
  extending coverage further.
- Web NextAuth student login (the `student-credentials` provider) gets
  failure-lock + quota tracking but, like all web flows, no `AuthSession`.
- No dedicated student self-service password-reset flow was found to wire
  session revocation into; only the `User`-account reset flow (Owner/Admin/
  VP/Teacher) and the admin-driven guardian password-set flow were wired.
