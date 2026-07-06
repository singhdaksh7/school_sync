# Backend Pilot Contract Freeze (Phase 4)

This document freezes the backend's external contract for UI/mobile/pilot
integration work that follows this phase. It does not describe internal
implementation — only what a client (web dashboard, mobile app, or a future
integration) can rely on.

## 1. Authentication surfaces (frozen)

| Surface | Mechanism | Notes |
|---|---|---|
| Owner/Admin/VP/Teacher web dashboard | NextAuth session cookie (`src/app/api/auth/[...nextauth]`) | Standard web session; no bearer token |
| Mobile staff (`/api/mobile/staff/login`) | Bearer token via `AuthSession` | Subject to login quota (6/24h) + active-session cap (3) |
| Mobile student (`/api/mobile/student/login`) | Bearer token via `AuthSession` | Login quota (3/24h) + active-session cap (2) |
| Parent (`/api/parent/login`, `/api/mobile/login`) | Bearer token via `AuthSession` | Login quota (3/24h) + active-session cap (3) |
| Unified mobile login (`/api/mobile/login`) | Tries guardian, then student; ambiguous match fails closed | See `unified-mobile-login.ts` |

All four credential-login flows share one enforcement path
(`completeSuccessfulLogin`/`completeSuccessfulWebLogin` in
`src/lib/auth-login-flow.ts`) serialized per-actor via a Postgres advisory
lock — **verified this phase, against real Postgres, under genuine
concurrency**: 10 truly simultaneous login attempts for one TEACHER actor
produced exactly 6 successes (the TEACHER quota) and 4 correct rejections,
with the active-session count never exceeding the configured cap of 3.

Session/quota policy is centralized in `src/lib/cost-guard-policy.ts` — treat
these numbers as product policy, not implementation detail, and expect
clients to handle `NEW_LOGIN_LIMIT_REACHED` / `429` responses gracefully.

## 1a. Additive mobile bootstrap contracts (Phase 6 — mobile shared foundation)

Two read-only, additive endpoints were added to close mobile integration gaps
identified while building the unified mobile app. Both derive their tenant
**exclusively from the authenticated bearer session** (mobile JWT or parent
JWT, same auth resolvers as `/api/mobile/me`) — never from a client-supplied
`schoolId` or request hostname.

- `GET /api/mobile/features` — returns `{ features: Record<FeatureFlagKey,
  boolean> }` for the authenticated actor's own school, using the exact same
  `getSchoolFeatureFlags` resolver every `requireSchoolFeature()` enforcement
  check already calls. **This does not alter existing entitlement
  enforcement** — every protected route still independently checks
  `requireSchoolFeature()` on the actual request; this endpoint is a
  read-only bootstrap view, and a `true` value here is not an authorization
  grant (Teacher permissions and Parent/Student actor rules remain
  separately authoritative).
- `GET /api/mobile/branding` — returns the same `BrandingResponse` DTO as the
  public `GET /api/branding` (`schoolName, logoUrl, primaryColor,
  secondaryColor, appName, poweredBySchoolSync`), resolved by `schoolId` from
  the bearer session via `resolveTenantBrandingForSchoolId` instead of by
  request hostname via `resolveTenantBranding`. **This does not alter
  branding resolution logic** — both call the same
  `brandingForSchool`/WHITE_LABEL rule; only the tenant lookup key differs.
  Exists because a mobile client hitting one shared, non-per-school-subdomain
  API host cannot be resolved by hostname the way a custom-domain web
  request can — session restore via `/api/mobile/me` needs this too, not
  just the initial login response.

Both routes apply `STANDARD_READ` Cost Guard classification and inherit
lifecycle enforcement for free — `getMobileAuth`/`getAuthenticatedGuardian`
already return `null` for a revoked session or a suspended/expired school, so
both routes 401 before reaching any business logic in that case, the same as
every other mobile-facing route.

## 2. Tenant/authorization model (frozen)

- Every school-scoped resource is reached under `/api/schools/[schoolId]/...`.
  A caller with no membership in `schoolId`, or whose school is
  `SUSPENDED`/`EXPIRED`, is denied — verified via `canAccessSchool`.
- Roles: `SCHOOL_OWNER`, `SCHOOL_ADMIN` — read+write. `VICE_PRINCIPAL` —
  read-only by product decision (`canWriteSchool` denies VP unconditionally,
  regardless of any other permission). `TEACHER` — scoped by
  `PERMISSION_CATALOG` (see `src/lib/teacher-permissions.ts`): `STUDENTS`,
  `ATTENDANCE`, `HOMEWORK`, `NOTEBOOK`, `MARKS`, `REPORT_CARDS`, `FEES`,
  `TEACHERS`, `ANNOUNCEMENTS`, `LEAVE`, `SETTINGS`, each with its own action
  set (e.g. `FEES`: `VIEW`/`RECORD_PAYMENT`/`DOWNLOAD_RECEIPT`) and an
  optional class/section scope.
- `FOUNDER` is a platform-level role, entirely separate from school
  membership — it does not go through `canAccessSchool`/`canWriteSchool` at
  all (verified structurally in `teacher-operations-authorization.test.ts`
  and re-confirmed this phase).
- **Effective-Primary/Effective-Alternate** (Teacher Operations Delegation):
  a teacher's operational authority is dynamic, resolved per-request from an
  ordered chain (`src/lib/operational-role-resolver.ts`), not from a static
  role. An Alternate gains real capability the instant the Primary becomes
  unavailable (leave approval, absence mark) with **no new login or session
  action** — verified in both the dedicated 32-step pilot suite and this
  phase's new cross-module closure script. Self-mutation is always forbidden
  even while delegated (`SELF_TEACHER_STATUS_MUTATION_FORBIDDEN`,
  `SELF_LEAVE_APPROVAL_FORBIDDEN`).
- Foreign-school and unauthenticated access are both denied by the same
  `canAccessSchool` check — verified explicitly this phase (steps 7-8 and
  30-33 of the new closure scenario).

## 3. Cost Guard (rate limiting) — current coverage, stated honestly

Categories are fixed (`src/lib/cost-guard-policy.ts`):
`STANDARD_READ` (60/min), `EXPENSIVE_READ` (10/min), `MUTATION` (20/min),
`UPLOAD` (10/hr, see also per-category upload quotas), `DOWNLOAD` (20/hr),
`PDF` (15/hr), `JOB_CREATE` (5/hr), `JOB_STATUS` (60/min), `AI_ACTOR`
(10/hr), `AI_SCHOOL` (50/day). A `429` includes a `Retry-After` header and
`retryAfterSeconds` in the JSON body — clients should treat this as
routine and back off, not as an error to surface destructively.

**Coverage is a curated subset, not universal, and that is a known,
documented gap — not an oversight.** As of this phase: 34 of 192 route
files have explicit Cost Guard enforcement wired (up from ~14 before this
phase); the remainder rely on tenant/RBAC checks alone for now. Everything
under `/api/auth/*`, the four login routes, `/api/health`, `/api/internal/*`,
and `/api/webhooks/*` are correctly Cost-Guard-EXEMPT by design (they use
their own IP/bucket-based auth throttling, a worker secret, or are a
stub/liveness endpoint respectively) — this is not part of the gap. See the
final risk register for the honest accounting of what remains unwired.

All categories fail OPEN if the rate-limit backend itself is unavailable,
**except** `AI_ACTOR`/`AI_SCHOOL`, which fail CLOSED (deny the request with a
clean temporary-service response) — a deliberate asymmetry, since an AI
category gates a real externally-billable provider call and every other
category gates ordinary CRUD that must never lock a whole school out over a
transient limiter outage.

## 4. Background jobs (frozen contract)

- `POST` a job-creating route → `202` with `{ jobId, status, totalItems }`
  (or `deduplicated: true` if an identical active job already existed).
- Poll `GET /api/schools/[schoolId]/jobs/[jobId]` (now `JOB_STATUS`-guarded)
  for `{ status, progress, totalItems, processedItems, failedItems,
  resultMetadata, errorSummary }`. Never returns raw internal payloads or
  stack traces.
- `SMART_TIMETABLE_GENERATION` and `REPORT_CARD_BATCH_GENERATION` are
  deduplicated at the database level (a partial unique index on
  `(schoolId, type, payloadFingerprint)` scoped to `PENDING`/`RUNNING` rows)
  — **verified this phase under genuine Postgres concurrency**: two truly
  simultaneous identical requests resolve to exactly one job row, with the
  loser's response transparently marked `deduplicated: true` rather than
  erroring. Clients must not assume two calls with identical input always
  produce two distinct job ids.

## 5. Health/readiness (frozen)

`GET /api/health` — liveness (default): `{ status: "ok", uptimeSeconds,
timestamp }`, dependency-free, safe to poll frequently, never Cost-Guard
throttled.

`GET /api/health?check=readiness` — three-state contract: `ready` (all
production dependencies configured), `degraded` (DB up, but in production
one of distributed-rate-limiting/storage/job-worker is unconfigured —
normal CRUD still works), `not_ready` (DB unreachable). Never exposes
connection strings, hostnames, credentials, or a login/credential oracle.
Verified by direct code read this phase — no changes needed.

## 6. Known deployment risk: `x-forwarded-host` trust (BEFORE PILOT)

`src/lib/school-resolver.ts`'s `hostnameFromHeaders` resolves the request
hostname as `headers.get("host") || headers.get("x-forwarded-host")`, used
by custom-domain tenant/branding resolution
(`resolveSchool`/`resolveTenantBranding`). If the production deployment sits
behind a reverse proxy/load balancer that does not strip a client-supplied
`X-Forwarded-Host` header before setting its own trusted value, a client
could in principle influence which school's branding/tenant context a
request resolves against via a custom-domain lookup.

This is **documented, not code-fixed**, by explicit design decision for this
phase: the correct fix is deployment configuration (ensure the edge
proxy/CDN always overwrites `X-Forwarded-Host` with its own value and never
forwards a client-supplied one), not an invented in-app proxy allowlist that
would only be guessing at the real deployment topology. **This must be
verified as part of the production deployment checklist, before pilot
traffic reaches a custom domain.**

## 7. What is explicitly NOT frozen / NOT in scope for this phase

- Academic/Examination/Accounts Head roles, WhatsApp/push/WebSockets/SSE,
  GPS tracking, biometric attendance, online student fee payment, a
  historical data warehouse — none of these exist and none were added.
- Full Cost Guard coverage of all 192 routes — a curated subset only (see
  §3 and the risk register).
- Any AWS/Terraform/production infrastructure provisioning.
