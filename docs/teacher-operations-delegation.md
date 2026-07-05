# Teacher Operations Head & Automatic Delegation — Architecture

## Product purpose

Let a school configure an ordered leadership chain (one Primary + N ordered
Alternates) for **daily teacher operations** — attendance management, leave
approval/rejection, arrangement/substitution assignment, and the narrow slice
of School Operations Command Center reads relevant to running the day. The
effective holder of that authority is resolved **dynamically, on every
request**, from live facts (approved leave, today's attendance, assignment
enable/disable, effective-date window) — never by copying permission rows
onto an alternate teacher and never by a cron/worker/manual "activate" step.

## Operational authority vs Admin authority

`TEACHER_OPERATIONS` is **not** a `UserRole`. It never turns a teacher into
`SCHOOL_ADMIN`. Owner/Admin authorization (`canAccessSchool`/`canWriteSchool`)
is checked **first**, unchanged, on every route this phase touches; the
operational-delegation path is only ever reached as a **fallback** when that
check fails and the actor is a `TEACHER` — so Admin/Owner/VP behavior is
identical to before this phase, by construction, not by a role check.

## TEACHER_OPERATIONS role, assignment chain, priority

`OperationalRoleAssignment` (one additive model, see PART 3):

| Field | Type | Purpose |
|---|---|---|
| `schoolId` | String (FK) | Tenant scope |
| `roleType` | String | `"TEACHER_OPERATIONS"` only, this phase (see `OPERATIONAL_ROLE_TYPES`) |
| `teacherId` | String (FK) | The assigned teacher |
| `priority` | Int | 0 = Primary, 1..N = Alternate 1..N, ascending failover order |
| `isEnabled` | Boolean | Manual enable/disable without deleting the assignment |
| `effectiveFrom` / `effectiveUntil` | Date? | Optional bounded window |
| `createdById` | String? (FK) | Admin who configured it |

`roleType` is a plain string (matching the existing `FeeStructure.frequency`
precedent), not a Prisma enum — a future role type needs no schema migration,
though only `TEACHER_OPERATIONS` is implemented/validated this phase.
Uniqueness: `(schoolId, roleType, teacherId)` and `(schoolId, roleType,
priority)` are both DB-enforced unique constraints (not just pre-validated in
application code — PART 32 concurrency safety).

## Assignment validation

`configureOperationalRoleChain` (`operational-roles.ts`) validates the
**entire submitted chain** before any write: non-negative integer priorities,
no duplicate priority, no duplicate teacher, `effectiveUntil >= effectiveFrom`,
and every teacher must belong to this school and not be soft-deleted. One
invalid member rejects the **whole** update — verified end-to-end (zero
partial writes) in both the unit tests and the pilot script. The chain is
replaced transactionally: delete the existing chain for
`(schoolId, roleType)` and insert the new one inside one `$transaction`.

## Effective role resolver

`resolveEffectiveOperationalRole({schoolId, roleType, at})`
(`operational-role-resolver.ts`) is the single source of truth. Order is
**strictly `priority` ascending** (never `createdAt`). Availability facts
reuse the SAME data model the School Operations Command Center phase already
established — `LeaveRequest` (type=TEACHER, status=APPROVED), `Attendance`
(type=TEACHER), `Teacher.isDeleted` — queried directly here (not via the
heavier `loadTodayOperationsContext` batched loader, which would be wasteful
for this resolver's hot, per-request authorization path; only
`resolveSchoolTodayDateOnly`, the lightweight date resolver, is reused
directly).

Returns a structured DTO (never a boolean or a free-text reason):
`effectiveTeacher`, `effectiveAssignmentId`, `effectivePriority`,
`assignmentType` (`PRIMARY`/`ALTERNATE`), `primaryTeacher`, a top-level
`reasonCode`, and the full `chain[]` with each assignment's own
`assignmentState` (`ACTIVE`/`STANDBY`/`UNAVAILABLE`) and `reasonCode`.

## Availability resolution, in order

1. `isEnabled === false` → `ASSIGNMENT_DISABLED`
2. `effectiveFrom` set and in the future → `ASSIGNMENT_NOT_STARTED`
3. `effectiveUntil` set and in the past → `ASSIGNMENT_ENDED`
4. `Teacher.isDeleted` → `TEACHER_DELETED`
5. Approved full-day leave covering today → `APPROVED_LEAVE`
6. `Attendance` status `ABSENT` today → `MARKED_ABSENT`
7. Otherwise **AVAILABLE** — the first available assignment in priority order
   becomes `ACTIVE` (`reasonCode: FIRST_AVAILABLE`); the rest are `STANDBY`.

`NOT_MARKED` (no `Attendance` row at all today) is **never** a failover
trigger — it produces `attendanceNotMarked: true` on an otherwise-available
assignment, an informational flag only. Phase 2's Needs Attention engine
already owns `TEACHER_STATUS_NOT_MARKED` alerting; no second alert system was
created for this.

**Documented limitation**: `TEACHER_INACTIVE` is defined in the reason-code
type for completeness but is currently **unreachable** — the schema has no
"inactive" concept for a `Teacher` beyond `isDeleted` (no separate
`isActive`/status field exists). If such a state is added later, this
resolver is the only place that needs to learn about it.

**Documented limitation**: only date-based (full-day) leave affects
delegation. `LeaveRequest` has no time-of-day granularity in the existing
schema — a half-day/time-aware failover is not representable and was not
claimed.

## Resolution reason codes

| Code | Meaning |
|---|---|
| `ASSIGNMENT_DISABLED` | Assignment exists but is manually disabled |
| `ASSIGNMENT_NOT_STARTED` | `effectiveFrom` is in the future |
| `ASSIGNMENT_ENDED` | `effectiveUntil` is in the past |
| `TEACHER_DELETED` | The assigned teacher is soft-deleted |
| `TEACHER_INACTIVE` | Reserved; unreachable with the current Teacher model |
| `APPROVED_LEAVE` | Approved full-day leave covers today |
| `MARKED_ABSENT` | Attendance(type=TEACHER) is ABSENT today |
| `AVAILABLE` | Available but not the first in priority order (STANDBY) |
| `FIRST_AVAILABLE` | Available and IS the effective assignee |
| `NO_ASSIGNMENTS_CONFIGURED` | No chain configured for this role at all |
| `NO_AVAILABLE_ASSIGNEE` | A chain exists but nobody is currently available |

## Automatic failover

Primary available → Primary effective. Primary unavailable (any reason above)
→ next available Alternate, in priority order. All unavailable →
`effectiveTeacher: null`, `NO_AVAILABLE_ASSIGNEE` — **never** a random
fallback teacher. Primary returns → Primary is effective again on the very
next resolution call. None of this requires a cron, a worker, a manual
"activate" mutation, or a permission-row copy — every call recomputes from
current facts.

## Dynamic operational permissions

`operational-capabilities.ts` defines one centralized
`TEACHER_OPERATIONS_CAPABILITIES` bundle, granted **uniformly** to whichever
teacher is currently effective (no Primary-vs-Alternate capability
difference). Reuse audit (PART 10):

| Capability | Existing permission reused? |
|---|---|
| `TEACHER_LEAVE_VIEW` / `APPROVE` / `REJECT` | `PERMISSION_CATALOG.LEAVE` ("VIEW"/"APPROVE") — already consumed by `/leaves` routes; APPROVE and REJECT share one underlying permission there today |
| `ARRANGEMENTS_MANAGE` / `SUBSTITUTIONS_ASSIGN` / `UNCOVERED_LECTURES_MANAGE` | `PERMISSION_CATALOG.TEACHERS.ASSIGN_SUBSTITUTIONS` — defined in the catalog but never consumed by any route before this phase |
| `ARRANGEMENTS_VIEW` / `SUBSTITUTIONS_VIEW` / `UNCOVERED_LECTURES_VIEW` | Aliases of one read capability (Arrangement is the canonical model — no separate Substitution model exists) |
| `OPERATIONS_TODAY_VIEW`, `TEACHER_STATUS_VIEW`, `CURRENT_PERIOD_VIEW`, `NEXT_PERIOD_RISK_VIEW`, `TEACHER_WORKLOAD_VIEW`, `DAILY_OPERATIONS_SUMMARY_VIEW` | New — Phase 2 denied TEACHER entirely from `/operations/*`; no existing equivalent |
| `TEACHER_ATTENDANCE_MANAGE` | New — no existing "manage another teacher's daily attendance" permission anywhere |

## Effective permission resolution & central authorization guard

`operational-authorization.ts` implements the two-step flow, split across
two call sites deliberately:

1. The route's **existing, unchanged** check (`canAccessSchool`/
   `canWriteSchool` for Owner/Admin/VP, or `authorizeTeacher`/
   `requireSchoolAccess` for a teacher's own base/custom-role permission).
2. **Only if step 1 denies AND the actor is a TEACHER**:
   `canManageTeacherOperations` — the effective-head fallback.

Owner/Admin never reach step 2 — they already pass or fail step 1. This is
enforced structurally (verified in tests, not just by convention).
`resolveTeacherEffectivePermissions` is a separate **composed read model**
("everything this teacher can currently do") for the self-status API — it is
never used to authorize a mutation, which always re-resolves independently.

`requireSchoolAccessOrOperationalCapability` (for `/leaves`, `/arrangements`)
and `guardOperationsCapability` (for `/operations/*`) both implement this
same flow for their respective route families.

## Operations Command Center route access matrix

| Route | Owner/Admin | VP | Effective Operations Head | Normal Teacher |
|---|---|---|---|---|
| Today summary | ✅ | ✅ | ✅ (`OPERATIONS_TODAY_VIEW`) | ❌ |
| Teacher Status Board | ✅ | ✅ | ✅ (`TEACHER_STATUS_VIEW`) | ❌ |
| Attendance completion | ✅ | ✅ | ✅ (`OPERATIONS_TODAY_VIEW`) | ❌ |
| Lecture Coverage | ✅ | ✅ | ✅ (`UNCOVERED_LECTURES_VIEW`) | ❌ |
| Current Period | ✅ | ✅ | ✅ (`CURRENT_PERIOD_VIEW`) | ❌ |
| Next Period Risk | ✅ | ✅ | ✅ (`NEXT_PERIOD_RISK_VIEW`) | ❌ |
| Teacher Workload | ✅ | ✅ | ✅ (`TEACHER_WORKLOAD_VIEW`) | ❌ |
| Needs Attention | ✅ | ✅ | ✅ (`OPERATIONS_TODAY_VIEW`) | ❌ |
| Activity timeline | ✅ | ✅ | ✅ (`OPERATIONS_TODAY_VIEW`) | ❌ |
| Daily Operations Summary | ✅ (full) | ✅ (full) | ✅ (`DAILY_OPERATIONS_SUMMARY_VIEW`, **fee/exam/report-card sections redacted**) | ❌ |
| Teacher daily status PATCH | ✅ | ❌ | ✅ (`TEACHER_ATTENDANCE_MANAGE`) | ❌ |
| Homework insights | ✅ | ✅ | ❌ (denied by default) | ❌ |
| Exam progress | ✅ | ✅ | ❌ (denied by default) | ❌ |
| Report card progress | ✅ | ✅ | ❌ (denied by default) | ❌ |
| Fee Today Insights | ✅ | ✅ | ❌ (denied by default) | ❌ |

The Operations Head is about **teacher and daily operations**, not
finance/administrative progress — per-route capability checks enforce this,
never a blanket "operations head gets every `/operations/*` route" rule.

## Teacher attendance management

`bulkSetTeacherDailyStatus` (`teacher-daily-status.ts`, Phase 2) is
**extended**, not rewritten: an optional `delegatedAudit` parameter carries
the effective-head context. Two consequences when present: (1) the actor's
OWN `teacherId` may never appear as a target
(`SELF_TEACHER_STATUS_MUTATION_FORBIDDEN`), and (2) the delegation context is
attached to the single summarized `ATTENDANCE_MARKED` audit row. Approved
leave still takes precedence over any attendance mutation, unchanged from
Phase 2.

## Teacher leave approval / rejection & self-approval protection

The existing `/leaves` routes are extended (not rewritten) with
`requireSchoolAccessOrOperationalCapability`. The self-approval rule
(`SELF_LEAVE_APPROVAL_FORBIDDEN`) is checked **server-side, immediately
before the mutation**, comparing the resolved actor `teacherId` (whichever
path authorized them) against the target `LeaveRequest.teacherId` — this
applies to a direct-custom-permission teacher AND a delegated effective head
alike (a pre-existing gap: no self-approval check existed at all before this
phase). Authority is re-resolved at the mutation, never trusted from an
earlier check.

## Leave-failover interaction (verified end-to-end)

Primary submits leave → cannot approve own → Admin approves → **the very
next** `resolveEffectiveOperationalRole` call (no cron, no extra mutation)
returns the Alternate effective → Alternate approves another teacher's leave
→ Alternate still cannot approve their own → Primary's leave ends → Primary
effective again, Alternate's delegated authority disappears on the next
resolution. Verified in `scripts/teacher-operations-pilot-verify.ts`.

## ABSENT-failover interaction & self-status-mutation protection

Marking the Primary `ABSENT` (admin path) flips the effective assignee on
the next resolution call; correcting them back to `PRESENT` flips it back —
no restoration job. An effective Alternate acting via the delegated
attendance-management path can never use it to change their **own** status
(`SELF_TEACHER_STATUS_MUTATION_FORBIDDEN`) — Owner/Admin retain full
authority over any teacher's status, including one that happens to equal
their own linked teacher record, since that path never carries
`delegatedAudit`.

## Arrangement / substitution management

Arrangement is the **canonical** model — no separate Substitution model
exists (confirmed by schema audit). A genuine gap was found and closed
minimally: **no route, not even for Admin, could previously assign one
specific substitute to one specific lecture** — only a whole-date
auto-generate sweep and a leave-approval trigger existed. `assignArrangement`
(`arrangements.ts`) is a thin additive upsert on the existing
`(date, absentTeacherId, period)` unique key; it does not reimplement ranking
or the sweep. The day-specific `rankReplacementTeachers`
(`teacher-ranking.ts`) remains the only substitute-ranking service used —
Smart Timetable's weekly `recommendTeachers` is never invoked here.

## Uncovered lecture resolution

The full flow (view uncovered lecture → get day-specific recommendations →
assign replacement → lecture becomes SUBSTITUTED → current/next-period
insight updates automatically) works end-to-end with no new mutation model:
`describeUncoveredLectures` (Phase 2) surfaces the recommendation, the new
`POST /arrangements` route assigns it, and `classifyTodayLectures` (Phase 2,
unmodified) reflects the change on its very next read since it queries
`Arrangement` live.

## Admin configuration & effective-status APIs

`GET`/`PUT /api/schools/[schoolId]/operational-roles/teacher-operations` —
Owner/Admin/VP read, Owner/Admin-only write, gated by `TEACHER_PERMISSIONS`
(see feature entitlement below). `PUT` validates and replaces the whole
chain transactionally, audited as `TEACHER_OPERATIONS_CHAIN_UPDATED` with
before/after summaries (teacherId/priority/isEnabled only — no PII beyond
what the chain already is).

`GET .../effective` — Owner/Admin/VP or any teacher in the school; **not**
feature-gated (an already-configured chain must keep resolving even if the
entitlement later lapses).

`GET /api/teacher/operational-roles/self-status` — the calling teacher's own
minimal status (`isEffectiveOperationsHead`, `delegated`, `reasonCode`);
never exposes the full chain to an unrelated teacher; also not feature-gated.

## Delegated action audit context

Every operational mutation (attendance, leave approve/reject, arrangement
assign/auto-generate, chain configuration) carries a structured metadata
block when the actor reached the mutation via delegation
(`buildDelegatedAuditMetadata`, `operational-audit.ts`):
`operationalRole`, `authorizationSource`, `actorTeacherId`, `delegated`,
`effectiveAssignmentId`, `effectivePriority`, `primaryTeacherId`,
`resolutionReasonCode`. Never a session/bearer token or password. Primary
action: `delegated: false`. `AuditLog.userId` already identifies the
teacher's linked `User` row (confirmed present for every mobile/session
teacher actor) — `actorTeacherId` is additional context, not a schema change.

## Needs Attention integration

One new deterministic code, `NO_ACTIVE_OPERATIONS_HEAD` — triggered ONLY when
a `TEACHER_OPERATIONS` chain is configured AND nobody is currently available
(`isOperationsHeadUnavailable`). A school that never configured the role
never sees it. Severity: `MEDIUM` normally, escalated to `CRITICAL` only when
there is also an imminent coverage risk (current-period or next-period
uncovered lectures) — reusing the SAME facts already in scope, never a second
scoring system. Action target: `OPERATIONS_ROLE_CONFIGURATION`.

## Feature entitlement decision

`TEACHER_PERMISSIONS` (the existing flag gating custom teacher role/
permission configuration) also gates the operational role **configuration**
routes (GET+PUT on `.../teacher-operations`) — the same kind of paid "custom
teacher authority" capability. The `.../effective` read and the teacher
self-status read are **not** gated, so an already-configured chain keeps
resolving operationally even if the entitlement later lapses — a school is
never silently left leaderless by a billing change.

## School lifecycle

Unchanged and authoritative. A genuine bug was found and fixed during this
phase: the teacher-delegation fallback path (reached only after the
Owner/Admin check already failed) did **not** independently re-check school
lifecycle, since `canManageTeacherOperations` itself has no lifecycle
awareness — a SUSPENDED/EXPIRED school could theoretically have let a
delegated teacher through. Fixed by adding an explicit `schoolLifecycleGate`
check on every teacher-delegation fallback path
(`operations-route-guard.ts`, `operational-authorization.ts`, and the two
arrangement routes) before any operational resolution is attempted. Verified
in the pilot script and covered by a dedicated regression test.

## Cost Guard integration

| Route | Category |
|---|---|
| Chain GET | `STANDARD_READ` |
| Chain PUT | `MUTATION` |
| Effective status GET | `STANDARD_READ` |
| Teacher self-status GET | `STANDARD_READ` |
| Operations routes (read) | `STANDARD_READ` (existing Phase 2 categories, unchanged) |
| Operations routes (daily-summary) | `EXPENSIVE_READ` (unchanged) |
| Teacher attendance / leave / arrangement mutations | `MUTATION` (existing categories, unchanged) |

Actor keys are always the REAL acting teacher's id when delegation is the
authorized path (`actorType: "TEACHER"`, `actorId: teacher.id`) — never the
Primary's id, never `ADMIN_STAFF` for a delegated teacher. No polling
exemption, no 5-second refresh.

## Session / JWT interaction

Phase 3 touches **zero** session/JWT construction code (`auth.ts`,
`auth.config.ts`, `mobile-auth.ts` are untouched by this phase). Becoming the
effective Operations Head creates no new `AuthSession`, reissues no token,
increments no login quota. `canManageTeacherOperations` /
`resolveEffectiveOperationalRole` are re-resolved from the database on
**every** request — a teacher's existing session dynamically gains and loses
operational mutation authority as underlying facts change, with no
login/logout required. No `operationsHead` claim exists in any JWT or
long-lived token; server-side re-resolution is the only source of authority.

## Cache guidance (documentation only — no client code built this phase)

- Effective Operations Head status: recommended TTL **30 seconds** — time/
  attendance/leave sensitive.
- Operations read capabilities: 30–60 seconds UI cache is acceptable (matches
  Phase 2's guidance for the underlying data).
- Any mutation: **always** server-authorized fresh, never client-cached
  authority.
- On a 403 for a previously-allowed capability, a future client should
  invalidate its effective-role/permission cache immediately.

## Concurrency / race safety

- Chain configuration: whole-chain replace inside one `$transaction`; DB
  unique constraints on `(schoolId, roleType, teacherId)` and
  `(schoolId, roleType, priority)` guard against a concurrent conflicting
  write, not just pre-validation.
- Every authorization check re-resolves from the database at request time —
  a stale client-held "I am the effective head" value can never authorize a
  write; the mutation route re-checks independently.
- Residual limitation (honestly documented, not solved): two near-simultaneous
  admin actions that both pass their own pre-check (e.g., two teachers'
  attendance corrected at the same instant) rely on Postgres's own
  transaction isolation for the underlying row writes, same as any other
  mutation in this codebase — this phase does not add a new distributed lock.

## Known limitations

- `TEACHER_INACTIVE` reason code is defined but currently unreachable (no
  separate inactive-teacher concept exists in the schema beyond `isDeleted`).
- Only date-based (full-day) leave affects delegation — no half-day/
  time-of-day-aware failover, since `LeaveRequest` has no time granularity.
- No caching layer wired into HTTP responses this phase (guidance only).
- Manual single-arrangement assignment (`assignArrangement`) is a genuinely
  new capability (previously absent even for Admin) — introduced minimally,
  reusing the existing model and ranking service, not a new subsystem.
