# School Operations Command Center — Architecture

## Goals

Give a School Owner/Admin (and read-only Vice Principal) a deterministic,
TODAY-focused operational picture of their school: who is present/absent/
on-leave, which lectures are covered vs uncovered, what needs the admin's
attention right now, and a same-day rollup of homework/exam/report-card/fee
activity. Every number here is a database aggregate or a pure function over
already-loaded data — **no LLM is used anywhere in this system** to compute
or infer operational state.

This is explicitly NOT: a Teacher Operations Head / delegation system, a
real-time socket layer, a historical BI/data-warehouse, or a rewrite of Smart
Timetable or Cost Guard (both are reused as-is).

## Domain terminology (PART 2)

- **TODAY** — the school's own local calendar date, derived from
  `School.timezone` (IANA identifier) via `Intl.DateTimeFormat`, never the
  server's UTC date and never a hardcoded timezone (see `src/lib/school-time.ts`).
- **TEACHER BASE ATTENDANCE STATUS** — `PRESENT | ABSENT | ON_LEAVE | NOT_MARKED`,
  resolved with approved full-day leave taking precedence over any
  conflicting `Attendance` row.
- **TEACHER OPERATIONAL STATUS** — `IN_CLASS | FREE | UNAVAILABLE | NOT_MARKED`,
  derived from base status plus the current period's lecture assignment.
- **CURRENT / NEXT PERIOD** — resolved from `SchoolPeriodSchedule` and the
  school-local time-of-day; six named states (see below).
- **COVERED / UNCOVERED LECTURE** — a scheduled instructional slot (has a
  `subject`) is `NORMAL` (assigned teacher present), `SUBSTITUTED` (an
  `Arrangement` row supplies a substitute), or `UNCOVERED` (neither).
- **NEEDS ATTENTION ITEM** — a structured, stable-`code` DTO with severity/
  imminence/count, never a free-text message.
- **ACTIVITY ITEM** — a normalized, noise-filtered `AuditLog` row.
- **DAILY OPERATIONS SUMMARY** — the full same-day digest composing every
  engine below.

## School-local time / period resolution (PART 3)

`School.timezone` (default `Asia/Kolkata`, preserving the app's existing
implicit assumption) and the new `SchoolPeriodSchedule` model (one row per
`periodNumber`, uniform across all working days — matching `TimetableSlot`'s
existing day-independent period-count granularity) are the only new schema.
`src/lib/school-time.ts` exports:

- `resolveSchoolLocalNow(timezone, now)` → `{dateKey, timeOfDay, jsWeekday}`,
  via `Intl.DateTimeFormat` (never a blind UTC read).
- `resolveCurrentPeriod({timeOfDay, dbDay, timetableWorkingDays, periods})` →
  one of six states: `BEFORE_SCHOOL | IN_PERIOD | BETWEEN_PERIODS |
  AFTER_SCHOOL | NON_WORKING_DAY | NOT_CONFIGURED`. `NOT_CONFIGURED` (never a
  fabricated period) is returned when a school has no `SchoolPeriodSchedule`
  rows at all.
- Period-boundary checks are lexicographic `"HH:MM"` string comparisons —
  deliberately not `Date` arithmetic — avoiding any DST/timezone edge case.
- Working-day convention matches `arrangements.ts`'s existing `jsToDbDay`
  exactly: 1=Mon..6=Sat, Sunday always closed, `School.timetableWorkingDays`
  caps which of days 1–6 are actually in use.

## Batched Today Operations Context (PART 4)

`src/lib/operations-context.ts`'s `loadTodayOperationsContext(schoolId, now)`
is the single batched loader every engine below consumes — one `Promise.all`
across school config, `SchoolPeriodSchedule`, teacher roster, today's teacher
`Attendance`, approved leaves, early leaves, `TeacherWorkloadOverride` rows,
today's `TimetableSlot`/`Arrangement` rows, and sections. Bounded (a
school-day's worth of rows is at most a few hundred even at pilot scale),
returned as `Map`s for O(1) lookup. `resolveSchoolTodayDateOnly(schoolId, now)`
is a lightweight sibling for routes that only need the date, not the full context.

## Lecture coverage engine (PART 10/11/12)

`src/lib/operations-lecture-coverage.ts`'s `classifyTodayLectures(ctx)` is the
**single authoritative classifier** — teacher status, teacher workload,
current-period ops, and next-period risk all consume its output rather than
re-deriving NORMAL/SUBSTITUTED/UNCOVERED independently. A slot only counts as
"scheduled" if it has a `subject`; a subject-having slot with no teacher and
no arrangement is `UNCOVERED`, never silently `NORMAL`.

Replacement recommendations reuse `src/lib/teacher-ranking.ts`'s
`rankReplacementTeachers` — the **day-specific** substitute-selection service
already used by `arrangements.ts` — **not** Smart Timetable's
`recommendTeachers`, which solves weekly allocation and is the wrong tool for
"who can cover this one period today."

Next-period risk uses named thresholds (`NEXT_PERIOD_RISK_THRESHOLDS`):
`MEDIUM_AT=1, HIGH_AT=2, HIGH_MAX=3, CRITICAL_AT=4` uncovered lectures.

## Teacher Today Status Engine + Status Board (PART 5/6)

`src/lib/operations-teacher-status.ts`. Base status precedence: `ON_LEAVE` >
`ABSENT`/`PRESENT` (from `Attendance`) > `NOT_MARKED`. Operational status is
`UNAVAILABLE` for `ON_LEAVE`/`ABSENT`, else `IN_CLASS`/`FREE` from the current
period's lecture assignment. The Status Board
(`filterAndPaginateTeacherStatuses`) supports filter-by-status and search,
paginated via the shared `src/lib/pagination.ts` contract.

## Teacher daily status admin mutation (PART 28/29)

A real per-teacher `Attendance` (type=`TEACHER`) model already existed
end-to-end (self-check-in, cutoff time, auto-absent sweep) — audited and
confirmed no new presence model was needed. The one genuine gap: admins could
not directly correct a teacher's attendance (the existing route explicitly
403s admin-marked TEACHER rows). `src/lib/teacher-daily-status.ts`'s
`bulkSetTeacherDailyStatus` closes this by reusing the same `Attendance`
table via one `$transaction` of upserts, rejecting (not silently ignoring) an
attempt to mark an approved-leave teacher, and writing exactly one summarized
`AuditLog` row per batch (`MAX_BATCH_SIZE=500`).

## Student attendance + completion engine (PART 8/9)

`src/lib/operations-attendance.ts`. `computeStudentAttendanceSummary` and
`computeAttendanceCompletion` are DB-side `groupBy`/`count` aggregates —
never a full row hydration. Section completion is `PENDING` (zero recorded),
`PARTIAL` (recorded < expected), or `SUBMITTED` (recorded ≥ expected); a
section with zero active students is excluded from the "expected" set
entirely rather than counted as trivially complete.

## Teacher workload insights (PART 13)

`src/lib/operations-teacher-workload.ts` reuses Smart Timetable's
`resolveEffectiveWorkloadRule` (teacher-workload-rules.ts) for max-daily/
max-consecutive thresholds — including a real per-teacher
`TeacherWorkloadOverride` row when one exists, batch-loaded into
`TodayOperationsContext.teacherWorkloadOverrides` — never a duplicated copy
of that resolution logic. Classification: `OVERLOADED | NORMAL | LIGHT_LOAD
(≤2 effective periods) | NO_LECTURE`.

## Needs Attention engine (PART 14)

`src/lib/operations-attention.ts`. Structured `AttentionItem` DTOs
(`code`/`severity`/`title`/`description`/`count`/`actionTarget`/`metadata`)
covering `UNCOVERED_LECTURES`, `NEXT_PERIOD_UNCOVERED`, `ATTENDANCE_PENDING`,
`ATTENDANCE_PARTIAL`, `TEACHER_STATUS_NOT_MARKED`, `TEACHER_LEAVE_PENDING`,
`EARLY_LEAVE_PENDING`, `HOMEWORK_REVIEW_BACKLOG`, `EXAM_MARKS_PENDING`,
`REPORT_CARD_JOB_COMPLETED`, `REPORT_CARD_GENERATION_FAILED`,
`SMART_TIMETABLE_DRAFT_READY`, `SMART_TIMETABLE_JOB_FAILED`. Priority order:
severity → a named per-code `IMMINENCE` rank → count (descending) → the
stable `code` string, so ordering is fully deterministic. Job/draft signals
(`loadNeedsAttentionJobSignals`) reuse the existing `BackgroundJob`/
`TimetableDraft` models directly — no new tracking table.

## Homework / exam / report-card / fee insights (PART 15–18)

- **Homework** (`operations-homework.ts`): created/due/overdue/submissions
  today, `pendingReview` (submitted but not yet `REVIEWED`/`REJECTED`),
  scored-today, and the top-5 pending-review groups by homework.
- **Exams** (`operations-exams.ts`): requires an explicit `examSchemeId` —
  "current exam" is **not inferable** (`ExamScheme`/`Exam`/`ExamResult` have
  no date or status fields; a `latest createdAt` guess was rejected as
  dishonest). Honesty caveat: `Exam` has no class/section scoping field, so
  "expected results" is computed against the whole school's roster, not a
  class-specific one.
- **Report cards** (`operations-report-cards.ts`): same explicit-scheme
  constraint; expected count is a real per-section student-count `groupBy`
  (the `expected: null` case in the type is defensive, for a genuinely
  unknown scenario that in practice never fires since zero-student sections
  are excluded).
- **Fees** (`operations-fees.ts`): manual ledger only. `totalExpectedAmount`
  is computed via `FeeStructure × student-count` aggregates (a `groupBy`,
  never a per-student JS loop), reusing the same per-structure "total due"
  convention as `student-fee-ledger.ts`. All amounts flow through
  `moneyToNumber` for Decimal-safety.

## Activity timeline, daily summary, operations health (PART 19–21)

- **Activity** (`operations-activity.ts`): normalized `AuditLog` rows,
  excluding a documented noise list (`LOGIN_SUCCESS/FAILED`, `INVITE_*`,
  `FOUNDER_INVITE_*`, `SUBSCRIPTION_UPDATED`, `PASSWORD_RESET_*`) so the
  timeline reads as school-operational activity, not an auth log dump.
- **Daily Operations Summary** (`operations-daily-summary.ts`): pure
  composition of every engine above into one digest DTO.
- **Today at School summary** (`operations-today-summary.ts`): a
  deliberately lighter PART 7 endpoint (teacher/attendance/coverage/next-
  period snapshot only) so the API surface isn't one giant endpoint.
- **Operations Health** (`operations-health.ts`): derived entirely from the
  Needs Attention list's severities (`CRITICAL` if any CRITICAL item exists,
  else `NEEDS_ATTENTION`/`GOOD`/`HEALTHY`). The `score` field is an optional,
  documented, deterministic informational number (100 minus a per-severity
  weighted deduction) — the named `status` is the authoritative verdict.

## API architecture (PART 22)

Route family under `/api/schools/[schoolId]/operations/*`: `today`,
`teachers/status` (GET+PATCH), `attendance`, `lecture-coverage`,
`current-period`, `next-period-risk`, `teacher-workload`, `attention`,
`homework`, `exams`, `report-cards`, `fees`, `activity`, `daily-summary` — 13
focused routes rather than one giant endpoint, sharing one guard
(`src/lib/operations-route-guard.ts`) for the repeated auth/tenant/Cost Guard
preamble.

## Authorization (PART 23)

Reuses `canAccessSchool`/`canWriteSchool` (`tenant.ts`) verbatim, never a
bespoke per-route check: Owner/Admin full access, Vice Principal read-only
(read routes only — the bulk teacher-status mutation uses
`canWriteSchool`, which explicitly excludes VP), Teacher always denied
(`isSchoolAdminReadRole` excludes TEACHER by design), Founder denied (not a
`SCHOOL_ADMIN_READ_ROLES` member — Founder is a separate control plane). The
school's lifecycle status (SUSPENDED/EXPIRED) is re-read from the DB on every
call via `canAccessSchool`.

## Feature entitlement (PART 24)

Core Today Operations is explicitly **exempt** from the `ANALYTICS` plan gate
(`src/lib/feature-routes.ts`'s `EXEMPT_ROUTE_RATIONALES`): every route here
answers "what's happening today", not deep historical/trend analytics (which
remains gated at `/schools/[schoolId]/analytics`). No operations route calls
`requireSchoolFeature` — verified by a static source-scanning test.

## Cost Guard classification (PART 25)

Every read route uses `STANDARD_READ` except `daily-summary`
(`EXPENSIVE_READ`, since it composes every other engine); the bulk
teacher-status mutation uses `MUTATION`. Enforced via
`guardOperationsRead`/`guardOperationsWrite` in `operations-route-guard.ts`,
which call `enforceActorRateLimit` exactly like every other Cost-Guard-era
route.

## Caching contract guidance (PART 26)

Not yet wired at the HTTP layer (no `Cache-Control`/CDN caching added in this
phase — out of scope for a first cut). Recommended TTLs for a future caching
layer, chosen to stay well inside "today" staleness tolerance and not
conflict with Cost Guard's existing mobile-cache contract:
`today`/`daily-summary`/`attention` 30–60s, `teachers/status`/`attendance`/
`lecture-coverage`/`current-period` 30s, `next-period-risk` 30s (time-
sensitive), `teacher-workload`/`homework`/`exams`/`report-cards`/`fees` 2–5
min, `activity` 60s.

## Performance / query architecture (PART 27)

No N+1 loops: every insight is a `groupBy`/`count`/`aggregate`, or operates
on the already-batched `TodayOperationsContext`. `pg` concurrent-query safety
was respected — no two queries share one connection/transaction
concurrently; independent queries use `Promise.all` (separate pool
connections), never a single client racing itself.

## Teacher presence data gap (PART 28)

No new model — a real `Attendance` (type=TEACHER) model already existed
end-to-end. The only closed gap was the admin correction path (see above).

## Migration discipline (PART 33)

One additive migration, `20260707010000_school_operations_command_center`,
applied strictly after Cost Guard's `20260707000000_cost_guard_session_hardening`
(never edited historically). Verified via a disposable Postgres:
`prisma migrate deploy` (all 39 migrations apply cleanly) then
`npm run prisma:check-drift` → "No difference detected."

## Pilot verification (PART 30/31)

`scripts/operations-pilot-verify.ts` extends the existing
`SCHOOL_A_CONFIG`/`SCHOOL_B_CONFIG` pilot fixtures for **one fixed
deterministic test date** (2026-03-16, a Monday — expressed as explicit UTC
instants so the resulting Asia/Kolkata wall-clock time is identical
regardless of the host machine's timezone; never `new Date()`), covering
teacher presence/leave/early-leave, `TeacherWorkloadOverride` reuse, real
substitute-arrangement generation, student attendance completion states,
homework/exam/report-card/fee activity, background-job/draft signals, and
activity-timeline noise filtering. **35/35 steps pass.**

Regression of the three pre-existing pilots on the same disposable database
confirms zero regression from this phase: `pilot-verify.ts` 16/16,
`smart-timetable-pilot-verify.ts` 26/26, `cost-guard-pilot-verify.ts` 25/25.

## Known limitations

- **Exam "expected" scope**: since `Exam`/`ExamScheme` carry no class/section
  field in the existing schema, exam-progress "expected" is whole-school, not
  class-specific. A future phase could add that scoping to `Exam` itself.
- **No caching layer wired yet** (PART 26 is guidance only, not implemented
  in HTTP responses this phase).
- **Report-card "expected" is per-section-with-students-only** — a section
  with zero enrolled students is excluded rather than reported as `expected:
  null`; the type still carries `null` defensively for a case that does not
  currently occur.
- **Fee expected-amount convention**: matches the existing
  `student-fee-ledger.ts` convention where a `FeeStructure.amount` is a flat
  per-student total due, not a frequency-multiplied recurring charge — this
  mirrors existing behavior rather than introducing new billing-cycle logic.
