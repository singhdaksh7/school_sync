# SchoolSync — AI & Developer Onboarding Document

This document is a permanent, point-in-time reference for the SchoolSync codebase. It was produced by a full read-through of `prisma/schema.prisma`, every `src/lib/*` helper, every `route.ts` under `src/app/api/**`, every page/layout under `src/app/**`, every `src/components/**` file, and all deployment/config/git history. File paths are cited throughout so claims can be re-verified as the code evolves — **treat this as a snapshot, not a guarantee**; re-check cited files before relying on specifics in code changes.

> **Read this first:** `AGENTS.md` at the repo root states this project runs a customized/future Next.js (`16.2.3`, see `package.json:39`) whose APIs/conventions may diverge from an AI assistant's training data, and instructs reading `node_modules/next/dist/docs/` (a real, present docs folder — `01-app`, `02-pages`, `03-architecture`, `04-community`) before writing code. Any AI assistant about to **write code** in this repo should do that first. This document itself made no code changes.

---

## 1. Project Overview

**What it does:** SchoolSync is a multi-tenant school-management ERP (SaaS) for K-12 schools. A school owner self-registers, creates their school ("tenant"), and the app then covers day-to-day operations: student/teacher records, attendance (students and teachers), timetables, homework (with online submission and scoring), exams and marks, report cards (with a visual template builder), fee collection (online via Razorpay or manual), leave requests with automatic substitute-teacher assignment, announcements, an audit trail, white-label branding per school, a parent portal, and mobile (JWT-API-based) access for staff and students. An AI Insights feature (Anthropic Claude) summarizes school health metrics for admins.

**Primary business goals:** Digitize and centralize school administration for individual schools as paying tenants; reduce manual work for attendance/timetable/substitution/report-card generation; offer schools their own branded experience (white-labeling) without separate deployments.

**Type of SaaS product:** Vertical B2B multi-tenant SaaS (Education / School ERP). Single codebase, single database, one school = one tenant, distinguished by a `schoolId` discriminator column on nearly every table. Strong India-market signal: Razorpay as the only payment gateway, INR currency in `src/lib/razorpay.ts`, hardcoded `+91` phone normalization in `src/lib/parent-auth.ts:15-24`.

**Major modules / features** (detailed in [§7](#7-business-modules)):
Tenant onboarding & branding · Classes/Sections · Teachers & custom Teacher RBAC · Students & Guardians · Attendance (student + teacher, with an auto-absent cutoff job) · Timetable (manual grid + constraint-based auto-generator) · Homework (assignment + online submission + scoring) · Exams & Marks · Report Cards + Template Builder · Fees & Payments (Razorpay) · Leave Requests + Early-Leave + automatic Substitute Arrangement engine · Announcements · Holidays · Audit Log · Parent Portal (API-only) · Mobile APIs (staff + student) · AI Insights.

---

## 2. Tech Stack

| Layer | Choice | Notes / Citation |
|---|---|---|
| Frontend framework | **Next.js 16.2.3**, App Router | `package.json:39`; see the AGENTS.md warning above |
| Language | **TypeScript 5**, strict mode | `tsconfig.json` |
| UI runtime | **React 19.2.4** | `package.json:44-45` |
| Styling | **Tailwind CSS v4** via `@tailwindcss/postcss` | `postcss.config.mjs` |
| Component primitives | **Radix UI** (avatar, checkbox, dialog, dropdown-menu, label, select, separator, slot, tabs, toast), wrapped shadcn-style with `class-variance-authority` | `src/components/ui/*`, `package.json:19-28` |
| Icons | lucide-react | |
| Theming | **next-themes**, light-only (`defaultTheme="light"`, `enableSystem={false}`) | `src/components/providers/ThemeProvider.tsx` |
| Forms | `react-hook-form` + `@hookform/resolvers` + `zod` are dependencies, but **not actually wired into client forms** in the files inspected — admin/teacher forms hand-roll `useState` (e.g. `BrandingClient.tsx`, `StudentsClient.tsx`, `onboarding/page.tsx`) | frontend-structure research |
| Backend | Next.js Route Handlers (`route.ts`) | `src/app/api/**`, ~106 route files |
| Database | **PostgreSQL** — AWS RDS in production today; originally Neon serverless | infra research; `321fb9b Switch from Neon to PrismaPg adapter for RDS` |
| ORM | **Prisma 7.7.0**, custom client output | `prisma/schema.prisma:1-4` (`output = "../src/generated/prisma"`) |
| DB adapters | `@prisma/adapter-pg` (live), `@prisma/adapter-neon` + `@neondatabase/serverless` (present, superseded — dead weight) | `package.json:14-17` |
| Auth — web | **NextAuth v5 (beta)** / Auth.js, Credentials provider, JWT session strategy | `src/lib/auth.ts`, `src/lib/auth.config.ts` |
| Auth — mobile (staff & student) | Hand-rolled JWT via `jsonwebtoken`, signed with `NEXTAUTH_SECRET` (reused, not a dedicated secret) | `src/lib/mobile-auth.ts` |
| Auth — parent portal | Hand-rolled JWT via `jsonwebtoken`, same shared secret | `src/lib/parent-auth.ts` |
| Password hashing | `bcryptjs` | |
| Payments | **Razorpay**, custom REST calls (no official SDK), HMAC webhook verification | `src/lib/razorpay.ts`, `src/app/api/webhooks/razorpay/route.ts` |
| AI | `@anthropic-ai/sdk` (Claude, model `claude-sonnet-4-6`, 1024 max tokens) for the AI Insights feature | `src/app/api/ai-insights/route.ts` |
| PDF generation | **Hand-rolled minimal PDF byte writer** — no `pdfkit`/`puppeteer`; text-only, no image embedding (asset URLs are listed as text references) | `src/lib/report-card-pdf.ts`, `src/lib/receipt-pdf.ts` |
| State management | **None** (no Redux/Zustand/Jotai) — Server Components do direct Prisma reads; client components use local `useState`/`useEffect` + `fetch` against the app's own API routes | frontend-structure research |
| Validation | `zod`, used server-side in most (not all) route handlers | |
| Mobile | No native/React Native code in this repo — "mobile" = a JSON+JWT API surface (`/api/mobile/*`) presumably consumed by a separate client app not present here | |
| Deployment | **AWS Amplify** (Lambda-hosted Next.js) is the real, wired-up target; `vercel.json` also exists but looks like a stale/parallel config — see [§13](#13-development-workflow) | `amplify.yml`, `vercel.json` |
| Linting | ESLint 9 flat config + `eslint-config-next` | `eslint.config.mjs` |
| Testing | **None.** Zero test files, zero test runner config anywhere in the repo | infra research |

---

## 3. Repository Structure

```
school_sync/
├── AGENTS.md / CLAUDE.md     # AI-assistant instructions (Next.js version warning)
├── amplify.yml               # AWS Amplify build spec (the real deploy pipeline)
├── vercel.json                # Vercel config — looks unused/stale, see §13
├── next.config.ts             # Default empty Next config, no custom settings
├── prisma.config.ts           # Prisma 7 config: schema/migrations paths, DIRECT_URL/DATABASE_URL
├── prisma/
│   ├── schema.prisma          # Single schema file, 27 models, 9 enums (§5)
│   └── migrations/            # 18 timestamped migrations, 2026-04-13 → 2026-06-15
├── public/                    # Only default Next.js placeholder SVGs — no real brand assets yet
└── src/
    ├── middleware.ts          # Edge auth gate (NextAuth JWT check + role redirects)
    ├── generated/prisma/      # Prisma client output (git-ignored, generated at build time)
    ├── lib/                   # Server-side business logic & auth helpers (§4, §6, §7)
    │   └── schoolsync/types.ts   # ORPHANED prototype types file — see §11
    ├── app/
    │   ├── api/                       # ~106 Route Handlers — see §8
    │   ├── page.tsx                   # Public marketing/login-chooser landing page
    │   ├── login/, register/, onboarding/
    │   ├── invite/[token]/, teacher-invite/[token]/
    │   ├── dashboard/[schoolSlug]/    # Owner/Admin/Vice-Principal web app (§7, §9)
    │   └── teacher/                   # Teacher web portal
    └── components/
        ├── ui/            # shadcn-style Radix primitives — generic, reusable
        ├── dashboard/      # Admin shell chrome only (Sidebar, Header, DashboardShell)
        ├── teacher/        # Teacher portal shell chrome (mirrors dashboard/)
        ├── providers/      # SessionProvider (NextAuth), ThemeProvider (next-themes)
        └── schoolsync/     # ORPHANED prototype theming component — see §11
```

### API organization
Routes live under `src/app/api/` and split into clear ownership zones:
- `schools/[schoolId]/**` — the admin/owner-facing tenant-scoped API (largest group, ~56 route files): classes, students, teachers, teacher-roles, attendance, timetable, exam-schemes, report-cards, report-card-templates, fee-structures, fee-payments, homework, leaves, early-leave, arrangements, announcements, holidays, audit-logs, branding, settings, guardians, analytics, invites.
- `teacher/**` — teacher self-service, shared by web session **and** mobile JWT (inconsistently — see [§11](#11-technical-debt)).
- `parent/**` — guardian/parent portal, JWT-only, no web UI exists for it.
- `student/**` — student self-service, mobile-JWT-only, no web UI exists for it.
- `mobile/**` — login/session endpoints (`staff/login`, `student/login`, `me`) that issue/restore the mobile JWT.
- `auth/**`, `invite/[token]`, `teacher-invite/[token]`, `school-by-slug/[slug]`, `branding`, `health`, `webhooks/razorpay`, `ai-insights` — cross-cutting/standalone routes.

### Shared libraries / utility folders
All cross-route logic lives in `src/lib/` (flat, no further nesting except the orphaned `schoolsync/` subfolder):

| File | Responsibility |
|---|---|
| `prisma.ts` | Prisma client singleton |
| `auth.ts` / `auth.config.ts` | NextAuth v5 setup (web sessions) |
| `tenant.ts` | Manual schoolId-scoped ownership checks (`canAccessSchool`, `canWriteSchool`, `sectionBelongsToSchool`, etc.) — the actual multi-tenant isolation mechanism |
| `school-resolver.ts` | Hostname → tenant resolution (subdomain or custom domain) for branding + login |
| `mobile-auth.ts` | Staff + student mobile JWT issue/verify |
| `parent-auth.ts` | Guardian/parent JWT issue/verify, phone normalization |
| `student-mobile-auth.ts` | Thin STUDENT-only narrowing wrapper over `mobile-auth.ts` |
| `teacher-permissions.ts` | Additive custom RBAC engine (catalog, scope resolution) — **not yet enforced anywhere** |
| `audit.ts` | Fire-and-forget `AuditLog` writer |
| `homework.ts` | Teacher-subject-section assignment validation, homework query includes |
| `arrangements.ts` | Substitute-teacher auto-assignment algorithm |
| `teacher-attendance.ts` | Teacher attendance cutoff-time logic |
| `report-cards.ts` / `report-card-templates.ts` / `report-card-pdf.ts` | Report card generation, template snapshotting, PDF rendering |
| `receipt-pdf.ts` | Fee receipt PDF rendering |
| `razorpay.ts` / `money.ts` | Payment gateway calls, signature verification, paise/rupee conversion |
| `school.ts` | Cached `getSchoolBySlug` |

### Components organization
- `src/components/ui/` — generic, role-agnostic design-system primitives (Radix + `cva`).
- `src/components/dashboard/` and `src/components/teacher/` — **shell chrome only** (sidebar/header/layout). Feature UI is **not** centralized here; each dashboard feature's interactive component (`*Client.tsx`) is co-located inside its own route folder, e.g. `src/app/dashboard/[schoolSlug]/fees/FeesClient.tsx`.
- `src/components/providers/` — app-wide context providers (session, theme).
- `src/components/schoolsync/` — orphaned, see [§11](#11-technical-debt).

### Database structure
See [§5](#5-database-analysis) for the full entity breakdown.

---

## 4. Architecture

**Architectural style:** Monolithic full-stack Next.js application — server-rendered pages and co-located API Route Handlers in one deployable unit. No microservices, no message queue, no background workers (the "auto-absent" and "auto-generate substitutions" jobs are synchronous HTTP-triggered functions, not cron-scheduled — they run when an admin/teacher action calls them, e.g. `POST /api/schools/[schoolId]/attendance/teacher-auto-absent`).

**Multi-tenant design:** Shared database, shared schema, **row-level isolation enforced entirely in application code** — there is no Postgres Row-Level Security. Almost every model carries a `schoolId` column (see [§5](#5-database-analysis)), and route handlers are individually responsible for filtering every query by it. The canonical helpers for this live in `src/lib/tenant.ts` (`canAccessSchool`, `canWriteSchool`, `sectionBelongsToSchool`, `studentBelongsToSchool`, etc.), but **~15+ older route files reimplement their own local ownership-check closure instead of importing these** (flagged in [§11](#11-technical-debt)) — meaning tenant-isolation logic is not fully centralized, and a future fix to the rules won't automatically propagate everywhere. Tenant *resolution* (which school a hostname belongs to) is separate from tenant *isolation* and lives in `src/lib/school-resolver.ts`, supporting both `{slug}.<rootdomain>` subdomains and a stored `customDomain` per school.

**Authentication flow (web):** `src/lib/auth.ts` configures NextAuth v5 with a single Credentials provider. On submit: look up `User` by email → `bcrypt.compare` password → if role is `TEACHER`, load the `Teacher` profile and verify its `schoolId` matches the hostname-resolved tenant (rejecting cross-tenant logins on custom domains); for owners/admins, same check against `ownedSchool`/`school`. On success, a JWT session (`session.strategy = "jwt"`) is minted carrying `role`, `schoolId`, `schoolSlug`, `teacherId`, `mentorSectionId` (`src/lib/auth.config.ts:52-62`). **Route gating is implemented twice**, nearly identically: `src/middleware.ts` (Edge middleware, checks `getToken()` directly) and `src/lib/auth.config.ts`'s `callbacks.authorized` (NextAuth's own gate). Both independently encode the public-route allowlist and the TEACHER-vs-admin-area redirect rules — a duplication worth being aware of when changing access rules.

**Authentication flow (mobile — staff & student):** `POST /api/mobile/staff/login` or `/api/mobile/student/login` → `authenticateStaffForMobile`/`authenticateStudentForMobile` (`src/lib/mobile-auth.ts:107,159`) → bcrypt check (+ optional hostname tenant check) → a custom 7-day JWT (`type: "mobile"`) is returned in the response body (not a cookie). Clients send it as `Authorization: Bearer <token>`; every protected route calls `getMobileAuth(req)` (`mobile-auth.ts:48`), which **re-fetches the User/Teacher/Student row from the DB on every request** (not trusting JWT claims alone) scoped by the token's `schoolId`. There is no refresh-token mechanism.

**Authentication flow (parent portal):** `POST /api/parent/login` (phone + password, India-only `+91` normalization) → `authenticateGuardian`-style flow in `src/lib/parent-auth.ts` → JWT (`role: "PARENT"`) → Bearer token, validated per-request via `getAuthenticatedGuardian`. **Fails closed (409)** if the same phone number matches guardians in more than one school — no disambiguation UI exists for that case.

**Authorization:** Base role hierarchy is the `UserRole` enum (`SCHOOL_OWNER`, `SCHOOL_ADMIN`, `VICE_PRINCIPAL`, `TEACHER`) plus two separate non-`User` actor types (`Student`, `Guardian`) with their own auth systems. On top of this sits an **opt-in additive RBAC layer** for teachers — `TeacherCustomRole` / `TeacherPermission` / `TeacherRoleAssignment` — fully modeled and CRUD-complete via the API, with a `module:action` permission catalog (`src/lib/teacher-permissions.ts:15-25`) and optional class/section scoping. **This layer is not enforced by any business route yet** — only the base `UserRole` + ownership checks gate real actions today; the one route that computes effective permissions (`GET /api/schools/[schoolId]/teachers/[teacherId]/permissions`) is explicitly a read-only preview, not an enforcement point.

**Data flow / request lifecycle:** Client → `middleware.ts` (Edge: JWT presence + role redirect) → Route Handler → `zod` parse (most, not all, routes) → tenant-ownership check (`tenant.ts` helper or a local closure) → Prisma query/mutation scoped by `schoolId` → optional side effect (`AuditLog` write, Razorpay call, PDF render, Anthropic call) → JSON response.

**Service boundaries:** None at the deployment level — "services" are just `src/lib/*` modules called in-process from route handlers. The closest thing to a domain service is the substitute-arrangement engine (`src/lib/arrangements.ts`), which is a pure algorithm invoked synchronously from three call sites (leave approval, early-leave approval, admin-triggered auto-generate).

---

## 5. Database Analysis

Single Postgres database (`prisma/schema.prisma`, 782 lines, 27 models, 9 enums). Every entity (except a few global join helpers) carries an explicit `schoolId` foreign key — this is the multi-tenant isolation backbone.

### Core entities by domain

| Domain | Models | Tenant scoping | Key uniqueness / indexes |
|---|---|---|---|
| Identity / Tenant | `User`, `School`, `SchoolInvite`, `TeacherInvite` | `User.schoolId` (nullable — owners use `ownedSchool` instead); `School` is the tenant root | `School.slug` unique, `School.customDomain` unique, `User.email` unique |
| Org structure | `Class`, `Section` | `Class.schoolId`; `Section` via `Class` | `@@unique([name, schoolId])` on Class, `@@unique([name, classId])` on Section |
| Staff | `Teacher`, `TeacherCustomRole`, `TeacherPermission`, `TeacherRoleAssignment` | `Teacher.schoolId` (+`@@index`) | `TeacherCustomRole @@unique([schoolId, name])`; `TeacherRoleAssignment @@unique([teacherId, roleId])` |
| Students / Guardians | `Student`, `Guardian`, `StudentGuardian` | `schoolId` on all three | `Student @@unique([rollNo, schoolId])` and `@@unique([schoolId, admissionNo])`; `Guardian @@unique([schoolId, phone])`; `StudentGuardian @@unique([studentId, guardianId])` |
| Attendance | `Attendance` (enum `AttendanceType` STUDENT/TEACHER, `AttendanceStatus` PRESENT/ABSENT/LATE) | `schoolId` | `@@unique([date, studentId])`, `@@unique([date, teacherId])`, `@@index([schoolId, date, type])` |
| Timetable | `TimetableSlot` | `schoolId` | `@@unique([sectionId, dayOfWeek, period])` |
| Exams & Marks | `ExamScheme`, `Exam`, `ExamResult` | `ExamScheme.schoolId` | `ExamResult @@unique([examId, studentId])` |
| Report Cards | `ReportCard`, `ReportCardSubject`, `ReportCardTemplate` (enum `ReportCardStatus` DRAFT/PUBLISHED) | `schoolId` on ReportCard + Template | `ReportCard @@unique([studentId, examSchemeId])`; `ReportCardTemplate @@index([schoolId, isDefault])` |
| Fees | `FeeStructure`, `FeePayment` | `schoolId` | `FeePayment.gatewayOrderId`/`gatewayPaymentId`/`receiptNumber` all unique |
| Homework | `Homework`, `HomeworkStudentStatus`, `HomeworkSubmission` (4 status-related enums) | `schoolId` on Homework + Submission | `HomeworkStudentStatus`/`HomeworkSubmission` both `@@unique([homeworkId, studentId])` — **two parallel status records per student, see §11** |
| Leave & Substitution | `LeaveRequest`, `TeacherEarlyLeaveRequest`, `Arrangement` | `schoolId` | `Arrangement @@unique([date, absentTeacherId, period])` |
| Org events | `Announcement`, `Holiday`, `SectionTransfer` | `schoolId` | `Holiday @@unique([date, schoolId])` |
| Ops / Meta | `AuditLog`, `AIInsightCache` | `schoolId` | `AIInsightCache.schoolId` unique (one cache row per school) |

### Relationships worth knowing
- `User` ←1:1→ `Teacher` (`Teacher.userId` unique) — a teacher's login identity and HR profile are separate models joined 1:1; `Teacher` can exist with `userId: null` before the invite is accepted.
- `School.ownerId` is unique — **one owner per school**, enforced at the DB level (and `POST /api/schools` also enforces "one owned school per user").
- `Section.mentorSectionId` (on `Teacher`, unique) — a section has at most one mentor/class-teacher, used as the "homeroom teacher" for report-card generation/publishing rights.
- `ReportCard.templateId` is `onDelete: SetNull` and `templateSnapshot` (Json) stores an **immutable copy** of the template at generation time — deleting or editing a template never changes already-generated report cards (`src/lib/report-card-templates.ts:126-160`, `src/lib/report-cards.ts:220-245`).
- `Arrangement` links an absent teacher, an optional substitute, an optional `LeaveRequest`, and a section/period — generated automatically (see [§7](#7-business-modules) "Leave Requests & Arrangements").
- `HomeworkStudentStatus` (one per student, created when homework is assigned) and `HomeworkSubmission` (created when a student/parent submits) carry near-duplicate status/score fields that three different write paths must keep in sync by hand — flagged in [§11](#11-technical-debt).

### Role models
- `UserRole` enum — coarse, global per-user role: `SCHOOL_OWNER | SCHOOL_ADMIN | VICE_PRINCIPAL | TEACHER`.
- `TeacherCustomRole` / `TeacherPermission` / `TeacherRoleAssignment` — fine-grained, per-school, additive RBAC for teachers only, with a fixed module/action catalog (`STUDENTS`, `ATTENDANCE`, `HOMEWORK`, `MARKS`, `REPORT_CARDS`, `FEES`, `TEACHERS`, `ANNOUNCEMENTS`, `SETTINGS` × various actions) and optional `classIds`/`sectionIds` scoping per assignment. Schema comment explicitly documents this as **opt-in and currently inert** for existing flows (`prisma/schema.prisma:735-738`).
- `Student` and `Guardian` are **not** `User` rows — they have their own `passwordHash` columns and are authenticated through entirely separate JWT systems, not NextAuth.

### Major business workflows reflected in the schema
1. **Leave → Arrangement automation**: approving a `LeaveRequest` (TEACHER type) or `TeacherEarlyLeaveRequest` triggers `src/lib/arrangements.ts` to create `Arrangement` rows filling every affected `TimetableSlot`.
2. **Homework lifecycle**: `Homework` created → `HomeworkStudentStatus` seeded for every student in the section → student/guardian submits → `HomeworkSubmission` created → teacher scores/reviews, writing back to both tables.
3. **Report card generation → publish → snapshot**: generate (DRAFT, recomputed from `ExamResult` + `Attendance` + template) → publish (locks `publishedAt`, becomes visible to parents/students) → template changes never retroactively affect published cards.
4. **Fee payment lifecycle**: `FeeStructure` defines what's owed → `FeePayment` created `PENDING` (Razorpay order) or directly `PAID` (manual) → Razorpay webhook or client-driven verify-payment flips status → receipt generated.

---

## 6. Authentication & Authorization

SchoolSync runs **three independent, parallel authentication systems** sharing one secret (`NEXTAUTH_SECRET`):

| System | Actor types | Mechanism | Entry points |
|---|---|---|---|
| Web sessions | `SCHOOL_OWNER`, `SCHOOL_ADMIN`, `VICE_PRINCIPAL`, `TEACHER` | NextAuth v5, Credentials provider, JWT-strategy session cookie | `/api/auth/[...nextauth]`, `src/lib/auth.ts` |
| Mobile JWT | Same staff roles + `STUDENT` | Hand-rolled `jsonwebtoken`, 7-day Bearer token, no refresh | `/api/mobile/staff/login`, `/api/mobile/student/login`, `/api/mobile/me` |
| Parent JWT | `Guardian` (role `PARENT`) | Hand-rolled `jsonwebtoken`, 7-day Bearer token, phone-based | `/api/parent/login` |

**Login systems in detail:**
- Web: `src/lib/auth.ts`'s `authorize()` does email lookup → `bcrypt.compare` → hostname/tenant cross-check → returns a user object NextAuth turns into a JWT (`role`, `schoolId`, `schoolSlug`, `teacherId`, `mentorSectionId`).
- Mobile staff: `authenticateStaffForMobile` (`src/lib/mobile-auth.ts:107`) — same bcrypt + tenant check, but issues its own JWT via `generateMobileToken` rather than going through NextAuth at all.
- Mobile student: `authenticateStudentForMobile` (`mobile-auth.ts:159`) — matches by `admissionNo` OR `email`, requires **exactly one** bcrypt match across all candidates (fails closed on ambiguity).
- Parent: `/api/parent/login` — phone normalized to `+91XXXXXXXXXX` via `normalizePhone` (`parent-auth.ts:15`), bcrypt against `Guardian.passwordHash`, **409 if the phone is ambiguous across schools**.

**Roles:** `UserRole` enum (`SCHOOL_OWNER | SCHOOL_ADMIN | VICE_PRINCIPAL | TEACHER`) is the only first-class role model; `STUDENT` and `PARENT` are role *strings* used only inside the respective JWT payloads, not part of the enum (since `Student`/`Guardian` aren't `User` rows at all).

**Permissions:**
- Coarse: ownership/admin-membership checks. `canAccessSchool(schoolId, userId)` = is owner or in `School.admins`. `canWriteSchool` = same, **except it explicitly excludes `VICE_PRINCIPAL`** from write access (`src/lib/tenant.ts:21-24`) — Vice Principal is read-mostly by design.
- Fine-grained (teachers only, currently inert): `teacherHasPermission(teacherId, schoolId, module, action)` and `getTeacherScope(...)` in `src/lib/teacher-permissions.ts` — merges all of a teacher's `TeacherRoleAssignment`s, any explicit `allowed: true` wins, defaults to **fully unrestricted** if a teacher has zero custom-role assignments (so adding this system never silently locks out existing teachers). Not yet called from any business route.

**JWT / session handling:**
- Web session: NextAuth JWT cookie, `session.strategy: "jwt"` (`auth.config.ts:16`), secret from `AUTH_SECRET` or `NEXTAUTH_SECRET` (both read, see [§13](#13-development-workflow) env table).
- Mobile/Parent JWTs: plain `jsonwebtoken.sign`/`verify`, **same secret as NextAuth**, 7-day fixed expiry, no rotation/refresh — re-login is the only way to extend a session. Every request **re-validates against the DB** (not just signature/expiry) by re-fetching the relevant `User`/`Teacher`/`Student`/`Guardian` row scoped by the token's embedded `schoolId`, so revoking access (e.g. deleting a teacher) takes effect immediately even though the token itself is still cryptographically valid until expiry.

**Middleware:** `src/middleware.ts` runs on the Edge for nearly every request (matcher excludes static assets), decodes the NextAuth JWT via `getToken()`, redirects unauthenticated users on non-public routes to `/login`, and redirects `TEACHER` away from `/dashboard/*` and non-teachers away from `/teacher/*`. **This logic is duplicated** in `src/lib/auth.config.ts`'s `callbacks.authorized` — both must be kept in sync manually if access rules change.

**Security mechanisms observed:**
- Razorpay payment/webhook signatures verified with HMAC-SHA256 + `crypto.timingSafeEqual` (`src/lib/razorpay.ts:16-47`) — correctly constant-time.
- Cross-tenant login rejected at the credential layer for both web and mobile staff logins (school-domain vs. user's actual school).
- **Critical gap:** `GET /api/health` (`src/app/api/health/route.ts`) has **no authentication at all** and (a) lists every registered user's masked email, (b) reports total user count and env-var presence, and (c) lets anyone test an arbitrary `?email=&password=` pair against bcrypt for any account in the database — effectively an open credential-testing oracle. **This should not be reachable in production as-is.**

**White-label restrictions:** Branding (`logoUrl`, `primaryColor`, `secondaryColor`, `appName`, `poweredBySchoolSync`, `customDomain`) is per-`School` and resolved by hostname via `src/lib/school-resolver.ts`. Today it only actually renders on the **public `/login` page** (`src/app/login/page.tsx` fetches `/api/branding`); once authenticated, the dashboard/teacher portal chrome always uses the static default theme — the component that would propagate branding into the authenticated app (`SchoolProvider` in `src/components/schoolsync/theme.tsx`) is never imported anywhere (see [§11](#11-technical-debt)).

---

## 7. Business Modules

| Module | Purpose | Main entities | Key APIs | Dependencies | Roles involved |
|---|---|---|---|---|---|
| **Schools (Tenant)** | Tenant creation, profile, multi-tenant resolution | `School` | `POST /api/schools`, `GET/PUT /api/schools/[schoolId]`, `GET /api/school-by-slug/[slug]` | `school-resolver.ts` | Owner (create/edit), Admin (view) |
| **White Labeling** | Per-school branding (logo/colors/app name/custom domain), surfaced today only on the public login page | `School` branding columns | `GET/PATCH /api/schools/[schoolId]/branding`, `GET /api/branding` (hostname-resolved) | `school-resolver.ts` | Owner/Admin configure; public consumes |
| **Teachers** | Staff directory, invites, mentor assignment | `Teacher`, `TeacherInvite`, `User` | `schools/[schoolId]/teachers*`, `teacher-invite/[token]` | Invite emails (token-based, no actual email send observed — link-based) | Owner/Admin manage; Teacher self (`teacher/me`) |
| **Teacher Roles & Permissions** | Additive RBAC for teachers — custom roles, module:action grants, class/section scoping | `TeacherCustomRole`, `TeacherPermission`, `TeacherRoleAssignment` | `schools/[schoolId]/teacher-roles*`, `.../teachers/[teacherId]/roles*`, `.../permissions` | `teacher-permissions.ts` | Owner/Admin configure; **not yet enforced** on Teacher actions |
| **Students** | Student directory, profiles, section transfers, bulk import | `Student`, `SectionTransfer` | `schools/[schoolId]/students*` (incl. `bulk`, `transfer`, `homework-summary`, `report-card`) | `tenant.ts` | Owner/Admin manage |
| **Parents (Guardians)** | Guardian directory and linking to students; parent-facing data access | `Guardian`, `StudentGuardian` | `schools/[schoolId]/guardians` (admin side), `parent/**` (parent self-service, JWT) | `parent-auth.ts` | Owner/Admin manage guardians; Parent (JWT) consumes own children's data |
| **Attendance** | Daily student & teacher attendance, auto-absent cutoff job | `Attendance` | `schools/[schoolId]/attendance*`, `teacher/attendance*`, `student/attendance`, `parent/attendance` | `teacher-attendance.ts` | Teacher marks; Owner/Admin views/reports; Student/Parent read own |
| **Timetable** | Weekly class/teacher schedule; manual editor + constraint-based auto-generator; teacher workload analytics | `TimetableSlot` | `schools/[schoolId]/timetable`, `.../custom-timetable`, `.../teachers/workload`, `teacher/timetable`, `student/timetable`, `parent/timetable` | — | Owner/Admin edit; everyone reads own |
| **Homework** | Assignment creation, per-student status tracking, online submission, scoring | `Homework`, `HomeworkStudentStatus`, `HomeworkSubmission` | `schools/[schoolId]/homework*`, `teacher/homework*`, `student/homework`, `parent/homework*` | `homework.ts` | Teacher creates/scores; Student/Parent submit & view |
| **Exams & Marks** | Exam scheme definition, marks entry, results | `ExamScheme`, `Exam`, `ExamResult` | `schools/[schoolId]/exam-schemes*`, `teacher/results`, `student/marks`, `parent/marks` | — | Owner/Admin/Teacher enter; Student/Parent read |
| **Report Cards** | Generate, publish, and serve student report cards (PDF) | `ReportCard`, `ReportCardSubject` | `schools/[schoolId]/report-cards*`, `teacher/report-cards*`, `student/report-cards`, `parent/report-cards*` | `report-cards.ts`, `report-card-pdf.ts` | Teacher (mentor) generates/publishes; Owner/Admin views all; Student/Parent see published only |
| **Report Card Templates** | Visual builder for report-card layout/branding/grading bands/custom sections | `ReportCardTemplate` | `schools/[schoolId]/report-card-templates*` (incl. `duplicate`, `preview`, `set-default`) | `report-card-templates.ts` | Owner/Admin only |
| **Fees** | Fee structure definition, online (Razorpay) & manual payment recording, receipts | `FeeStructure`, `FeePayment` | `schools/[schoolId]/fee-structures*`, `.../fee-payments`, `parent/fees*`, `webhooks/razorpay` | `razorpay.ts`, `money.ts`, `receipt-pdf.ts` | Owner/Admin manage & record manual payments; Parent pays online |
| **Leave Requests & Arrangements** | Student/teacher leave approval; automatic substitute-teacher assignment on approval | `LeaveRequest`, `TeacherEarlyLeaveRequest`, `Arrangement` | `schools/[schoolId]/leaves*`, `.../early-leave*`, `.../arrangements*`, `teacher/leaves`, `teacher/early-leave`, `teacher/arrangements` | `arrangements.ts` | Teacher requests; Owner/Admin approves; algorithm auto-assigns substitutes |
| **Notifications (Announcements)** | School-wide announcements (no push/email/SMS — in-app/API only) | `Announcement` | `schools/[schoolId]/announcements*`, `student/announcements`, `parent/announcements` | — | Owner/Admin post; everyone reads |
| **Holidays** | School holiday calendar | `Holiday` | `schools/[schoolId]/holidays*` | — | Owner/Admin manage |
| **Audit Log** | Tracks key mutations (students, guardians, fees, leaves, transfers, arrangements) for admin review | `AuditLog` | `schools/[schoolId]/audit-logs` (read), `audit.ts` (write, fire-and-forget) | — | Owner/Admin view |
| **Mobile APIs** | Login + session-restoration for staff and student native/mobile clients | n/a (cross-cutting) | `mobile/staff/login`, `mobile/student/login`, `mobile/me` | `mobile-auth.ts` | Staff roles + Student |
| **AI Insights** | Anthropic-Claude-generated school health summary, cached 30 days per school | `AIInsightCache` | `POST /api/ai-insights` | `@anthropic-ai/sdk` | Owner/Admin (see weak-check note in [§11](#11-technical-debt)) |
| **Founder Portal** | **Does not exist.** No code, route, role, or schema element references a cross-school/platform-admin concept anywhere in the repo (confirmed via repo-wide grep for "founder", "SUPER_ADMIN", "platform admin" — zero matches). If planned, it has no scaffolding yet | — | — | — |

---

## 8. API Inventory

Grouped by business module; columns are `Method | Route | Purpose | Roles/Auth Required` throughout, as requested. Route paths use the literal Next.js dynamic-segment syntax.

### Auth & Tenant Resolution

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth v5 catch-all — credentials login, session/JWT issuance | Public |
| GET | `/api/auth/redirect` | Post-login router (TEACHER → `/teacher/attendance`; has school → `/dashboard/[slug]`; else `/onboarding`) | Authenticated session |
| POST | `/api/auth/register` | Self-register a new `SCHOOL_OWNER` account | Public |
| GET | `/api/branding` | Resolve white-label branding from request hostname | Public |
| GET | `/api/school-by-slug/[slug]` | Resolve `{id,name,slug}` by slug | Any authenticated user (**not scoped to caller's own school** — see §11) |
| GET | `/api/health` | Diagnostics: DB connectivity, env presence, user emails, password test | **None — critical, see §11** |
| GET/POST | `/api/invite/[token]` | Resolve / accept an admin or vice-principal `SchoolInvite` | Public, token-gated |
| GET/POST | `/api/teacher-invite/[token]` | Resolve / accept a `TeacherInvite` | Public, token-gated |
| POST | `/api/mobile/staff/login` | Staff email+password login, issues mobile JWT | Public (credentials) |
| POST | `/api/mobile/student/login` | Student admissionNo/email+password login, issues mobile JWT | Public (credentials) |
| GET | `/api/mobile/me` | Session restoration for any mobile or parent JWT | Mobile JWT or Parent JWT |
| POST | `/api/parent/login` | Guardian phone+password login, issues parent JWT | Public (credentials) |

### Schools / Tenant Management

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| POST | `/api/schools` | Create a school (tenant) for the current user (one per owner) | Authenticated, no existing owned school |
| GET | `/api/schools/[schoolId]` | School profile + admin list | Owner or admin |
| PUT | `/api/schools/[schoolId]` | Update school profile | **Owner only** |
| GET | `/api/schools/[schoolId]/analytics` | Attendance/marks dashboard analytics, at-risk students | Owner or admin |
| GET/PATCH | `/api/schools/[schoolId]/branding` | Read/update white-label config | `canWriteSchool` |
| GET | `/api/schools/[schoolId]/audit-logs` | Audit trail (filterable, capped 200) | Owner or admin |
| GET/PATCH | `/api/schools/[schoolId]/settings/attendance` | Teacher attendance cutoff time | `canAccessSchool` / `canWriteSchool` |

### Classes, Sections & Timetable

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/classes` | List / create classes | Owner or admin |
| DELETE | `/api/schools/[schoolId]/classes/[classId]` | Delete a class | `canAccessSchool` |
| POST/DELETE | `/api/schools/[schoolId]/classes/[classId]/sections` | Create / delete a section | `canAccessSchool` |
| GET/PUT | `/api/schools/[schoolId]/timetable` | Fetch / upsert timetable slots, conflict check, set periods/day | `canAccessSchool` / `canWriteSchool` |
| POST | `/api/schools/[schoolId]/custom-timetable` | Constraint-based auto-generate or save a custom timetable | `canWriteSchool` |
| GET | `/api/schools/[schoolId]/teachers/workload` | Weekly per-teacher workload analytics | Owner or admin |
| GET | `/api/teacher/timetable` | Teacher's own weekly timetable | `getTeacherAuth` (mobile or web) |
| GET | `/api/student/timetable` | Student's own section timetable | Student mobile JWT |
| GET | `/api/parent/timetable?studentId=` | Linked child's timetable | Parent JWT + access check |

### Teachers & Teacher Roles/Permissions

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/teachers` | List / create teachers (auto-invite on create) | Owner or admin |
| PUT/DELETE | `/api/schools/[schoolId]/teachers/[teacherId]` | Update / delete teacher | `canAccessSchool` |
| POST | `/api/schools/[schoolId]/teachers/bulk` | Bulk-import teachers + invites | Owner or admin |
| GET | `/api/schools/[schoolId]/teachers/[teacherId]/permissions` | Compute effective merged permissions (read-only demo, not enforced) | `canAccessSchool` |
| GET/POST | `/api/schools/[schoolId]/teachers/[teacherId]/roles` | List / assign custom role to teacher | `canAccessSchool` / `canWriteSchool` |
| DELETE | `/api/schools/[schoolId]/teachers/[teacherId]/roles/[assignmentId]` | Remove role assignment | `canWriteSchool` |
| GET/POST | `/api/schools/[schoolId]/teacher-roles` | List / create custom roles | `canAccessSchool` / `canWriteSchool` |
| PATCH/DELETE | `/api/schools/[schoolId]/teacher-roles/[roleId]` | Update / delete custom role | `canWriteSchool` |
| GET | `/api/teacher/me` | Teacher profile + mentor section + students | `getTeacherAuth` |

### Students & Guardians

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/students` | List / create students | `canAccessSchool` |
| GET/PUT/DELETE | `/api/schools/[schoolId]/students/[studentId]` | Student detail / update / delete | `canAccessSchool` |
| GET/POST | `/api/schools/[schoolId]/students/[studentId]/transfer` | Transfer history / perform section transfer | `canAccessSchool` |
| GET | `/api/schools/[schoolId]/students/[studentId]/homework-summary` | Per-student homework completion stats | `canAccessSchool` |
| GET | `/api/schools/[schoolId]/students/[studentId]/report-card` | Ad-hoc composite report view (legacy, distinct from `ReportCard` model) | Owner or admin |
| POST | `/api/schools/[schoolId]/students/bulk` | Bulk-import students | `canWriteSchool` |
| GET/POST | `/api/schools/[schoolId]/guardians` | List guardians / upsert guardian + link students | `canAccessSchool` (blocks VICE_PRINCIPAL on write) |
| GET | `/api/parent/children` | Guardian's linked children | Parent JWT |

### Attendance

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET | `/api/schools/[schoolId]/attendance` | Fetch records by date/type/section | `canAccessSchool` |
| POST | `/api/schools/[schoolId]/attendance` | **Dead — always 403** | `canWriteSchool` (logic always rejects) |
| GET | `/api/schools/[schoolId]/attendance/summary` | Aggregate summary over a date range | Owner or admin |
| POST | `/api/schools/[schoolId]/attendance/teacher-auto-absent` | Run cutoff-time auto-absent job | `canWriteSchool` |
| GET/POST | `/api/teacher/attendance` | Mentor views/marks section student attendance | Web session — TEACHER |
| POST | `/api/teacher/attendance/mark` | Teacher self-marks own attendance | `getTeacherAuth` |
| GET | `/api/teacher/attendance/today` | Teacher's own attendance + cutoff status | `getTeacherAuth` |
| GET | `/api/student/attendance` | Own last-30-day attendance + summary | Student mobile JWT |
| GET | `/api/parent/attendance?studentId=` | Linked child's last-30-day attendance | Parent JWT + access check |

### Exams & Marks

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/exam-schemes` | List / create exam schemes + exams | `canAccessSchool`(+TEACHER read) / `canWriteSchool` |
| DELETE | `/api/schools/[schoolId]/exam-schemes/[schemeId]` | Delete scheme | `canWriteSchool` |
| GET/POST | `/api/schools/[schoolId]/exam-schemes/[schemeId]/results` | List / bulk-upsert marks | `canAccessSchool` (note: not write-tier — see §11) |
| GET/POST | `/api/teacher/results` | Teacher views/enters marks for assigned section | Web session — TEACHER |
| GET | `/api/student/marks` | Own results with computed grade | Student mobile JWT |
| GET | `/api/parent/marks` | Linked child's results | Parent JWT + access check |

### Report Cards & Templates

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET | `/api/schools/[schoolId]/report-cards` | List report cards | `canAccessSchool` |
| GET | `/api/schools/[schoolId]/report-cards/[id]` / `/pdf` | Detail / PDF | `canAccessSchool` |
| GET/POST | `/api/schools/[schoolId]/report-card-templates` | List / create templates | `canAccessSchool` / `canWriteSchool` |
| GET/PATCH/DELETE | `/api/schools/[schoolId]/report-card-templates/[templateId]` | Detail / update / delete | mixed, see §11 |
| POST | `/api/schools/[schoolId]/report-card-templates/[templateId]/duplicate` | Clone template | `canWriteSchool` |
| POST | `/api/schools/[schoolId]/report-card-templates/[templateId]/preview` | PDF preview with sample data | `canAccessSchool` |
| POST | `/api/schools/[schoolId]/report-card-templates/[templateId]/set-default` | Atomically set default | `canWriteSchool` |
| GET | `/api/teacher/report-cards` | Mentor's generated cards + schemes | Web session — TEACHER (mentor) |
| POST | `/api/teacher/report-cards/generate` | Generate cards for mentor section | Web session — TEACHER (mentor) |
| GET | `/api/teacher/report-cards/[id]/pdf` | Download (mentor-owned only) | Web session — TEACHER |
| POST | `/api/teacher/report-cards/[id]/publish` | Publish a DRAFT card | Web session — TEACHER |
| GET | `/api/student/report-cards` | Own published cards | Student mobile JWT |
| GET | `/api/parent/report-cards` / `/[id]/pdf` | Linked children's published cards / PDF | Parent JWT |

### Fees & Payments

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/fee-structures` | List / create fee structures | `canAccessSchool` |
| DELETE | `/api/schools/[schoolId]/fee-structures/[feeStructureId]` | Delete | Owner or admin |
| GET/POST | `/api/schools/[schoolId]/fee-payments` | List / record manual payment | `canAccessSchool` |
| GET | `/api/parent/fees` | Pending fees + history for all children | Parent JWT |
| POST | `/api/parent/fees/create-order` | Create/reuse Razorpay order | Parent JWT + access check |
| POST | `/api/parent/fees/verify-payment` | Verify signature, mark PAID | Parent JWT + access check |
| GET | `/api/parent/fees/[paymentId]/receipt` | PDF receipt | Parent JWT **or** web admin session (broad — see §11) |
| POST | `/api/webhooks/razorpay` | Razorpay server-to-server payment webhook | Signature-verified, no session |

### Homework

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/homework` | List (with assignment matrix) / create | `canAccessSchool` / `canWriteSchool` |
| PATCH/DELETE | `/api/schools/[schoolId]/homework/[homeworkId]` | Update / soft-cancel | `canWriteSchool` / `canAccessSchool` |
| GET/POST | `/api/teacher/homework` | List own/assigned / create | `getTeacherAuth` |
| PATCH | `/api/teacher/homework/[homeworkId]` | Update | Web session — TEACHER |
| POST | `/api/teacher/homework/[homeworkId]/scores` | Bulk score/check/reject | Web session — TEACHER |
| GET/PATCH | `/api/teacher/homework/[homeworkId]/submissions[/​[submissionId]]` | List / review one submission | Web session — TEACHER |
| GET | `/api/student/homework` | Own homework + status | Student mobile JWT |
| GET | `/api/parent/homework` | Linked children's parent-visible homework | Parent JWT |
| POST | `/api/parent/homework/[homeworkId]/submit` | Submit on behalf of a child | Parent JWT + access checks |

### Leaves, Early-Leave & Arrangements

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/leaves` | List / create leave requests | `canAccessSchool` |
| PATCH/DELETE | `/api/schools/[schoolId]/leaves/[leaveId]` | Approve/reject (auto-creates arrangements) / delete | `canAccessSchool` |
| GET | `/api/schools/[schoolId]/early-leave` | List early-leave requests | Owner or admin |
| PATCH | `/api/schools/[schoolId]/early-leave/[id]` | Approve/reject (auto-creates arrangements) | `canWriteSchool` |
| GET | `/api/schools/[schoolId]/arrangements` | List arrangements | **No tenant check called** — see §11 |
| POST | `/api/schools/[schoolId]/arrangements/auto-generate` | Admin-triggered sweep for a date | `canWriteSchool` |
| GET/POST | `/api/teacher/leaves` | List/create own leave requests | Web session — TEACHER |
| GET/POST | `/api/teacher/early-leave` | List/create own early-leave (1/day max) | `getTeacherAuth` |
| GET | `/api/teacher/arrangements` | Own assigned substitutions (±7d) | `getTeacherAuth` |

### Announcements, Holidays & Audit

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| GET/POST | `/api/schools/[schoolId]/announcements` | List / create | Owner or admin |
| DELETE | `/api/schools/[schoolId]/announcements/[announcementId]` | Delete | Owner or admin |
| GET/POST | `/api/schools/[schoolId]/holidays` | List / create | Owner or admin |
| DELETE | `/api/schools/[schoolId]/holidays/[holidayId]` | Delete | Owner or admin |
| GET | `/api/student/announcements` / `/api/parent/announcements` | Read announcements | Student / Parent JWT |

### AI Insights

| Method | Route | Purpose | Roles/Auth Required |
|---|---|---|---|
| POST | `/api/ai-insights` | Generate/cache Anthropic-Claude school-health insights (30-day cache) | Web session; admin check is weak — see §11 |

---

## 9. Mobile Integration

There is **no native or React-Native code in this repository** — "mobile" refers entirely to a JSON+JWT API surface intended for a separate client app.

**Mobile authentication:**
- `POST /api/mobile/staff/login` — `{email, password}` → `authenticateStaffForMobile` (`src/lib/mobile-auth.ts:107`) resolves tenant from request hostname, restricts to `STAFF_ROLES` (owner/admin/VP/teacher), bcrypt-checks, cross-validates the teacher's school against the resolved tenant, then `generateMobileToken` signs a `{type:"mobile", role, userId, teacherId?, schoolId, schoolSlug, name, email}` JWT (7-day expiry) with `NEXTAUTH_SECRET`. Response: `{token, role, user, school}`.
- `POST /api/mobile/student/login` — `{admissionNo|email, password}` → `authenticateStudentForMobile` (`mobile-auth.ts:159`) finds all matching `Student` rows (optionally hostname-scoped), bcrypt-checks each, requires exactly one match. Same JWT shape with `role:"STUDENT"`, `studentId`.

**Mobile APIs:** `getMobileAuth(req)` (`mobile-auth.ts:48`) is the universal verifier — reads the `Authorization: Bearer` header, `jwt.verify`s it, then **re-fetches the school and the relevant User/Teacher/Student row from the DB** scoped by the token's `schoolId` (never trusts the JWT payload alone for current state). `getTeacherAuth` (`mobile-auth.ts:92`) layers a web-session fallback on top, so some — **not all** — teacher routes accept either a mobile JWT or a NextAuth web session (see the inconsistency flagged in [§11](#11-technical-debt)).

**Student flows:** Students have **no web login path at all** — the mobile JWT is their only way into the system. Once authenticated, they can hit `/api/student/{attendance,homework,marks,timetable,announcements,report-cards}` — all read-only except implicitly via the parent's homework-submission route.

**Parent flows:** Parents also have no web UI, only `/api/parent/*` behind their own JWT (issued by `/api/parent/login`, not part of the mobile-staff/student system, but unified at the `mobile/me` restoration endpoint). Parents can view announcements/attendance/marks/timetable/homework/report-cards (published only) for linked children (`guardianCanAccessStudent` in `src/lib/parent-auth.ts:68` gates every access), submit homework on a child's behalf, and pay fees via Razorpay (`create-order` → client-side Razorpay checkout → `verify-payment`, with the webhook as a secondary server-to-server confirmation path).

**Teacher flows:** Teachers are the only role with **both** a full web portal (`/teacher/*` pages) and mobile API access, but the two surfaces are not symmetric — several teacher actions (mentor attendance marking, leave requests, exam marks entry, homework grading/scoring, all of report-cards) are currently web-session-only and **unreachable from a mobile client** even though a teacher mobile JWT exists (compare `src/app/api/teacher/attendance/mark/route.ts`, which accepts `getTeacherAuth`, against `src/app/api/teacher/attendance/route.ts`, which doesn't).

**Session restoration:** `GET /api/mobile/me` is the single rehydration endpoint — tries `getMobileAuth` (staff/student) first, falls back to `getAuthenticatedGuardian` (parent), returns a uniform `{role, user|student, school}` shape regardless of which credential type matched.

**Token handling:** No refresh tokens. Tokens are valid for a fixed 7 days; clients are expected to re-prompt login on expiry/401. All three JWT systems (mobile staff/student, parent, and NextAuth's own JWT) share the same `NEXTAUTH_SECRET` signing key rather than using separate secrets per system.

---

## 10. Current Implemented Features

| Category | Features |
|---|---|
| **Production Ready** | Tenant onboarding & school creation · Web auth (NextAuth) with tenant-domain binding · Classes/Sections CRUD · Teacher CRUD + invite flow · Student CRUD + bulk import + section transfer · Attendance marking (student via teacher portal, teacher self-marking) + auto-absent cutoff job · Manual timetable editor · Exam schemes + marks entry · Report card generation/publish + visual template builder with immutable snapshotting · Fee structures + manual payment recording + Razorpay online payment (order/verify/webhook) + PDF receipts · Leave requests + automatic substitute-arrangement generation (full-day and early-leave) · Announcements · Holidays · Audit log (partial coverage) · Mobile staff/student login + most read-only mobile APIs · Parent portal API (read access + homework submission + fee payment) |
| **Partially Implemented** | **Teacher custom RBAC** — full schema + CRUD API exists (`TeacherCustomRole`/`Permission`/`Assignment`), but zero business routes enforce it yet; only a read-only "preview" endpoint exists (`src/app/api/schools/[schoolId]/teachers/[teacherId]/permissions/route.ts`) · **White-labeling** — branding config + public login-page rendering works, but never propagates into the authenticated dashboard/teacher UI · **Mobile coverage for teachers** — staff/student login and many reads work, but mentor attendance, leave requests, marks entry, homework grading, and all report-card actions are web-session-only · **Audit logging** — only covers students, guardians, fee payments, leave/early-leave approvals, and arrangement auto-generation; many other mutations (announcements, classes, exam schemes, fee structures, holidays, teachers, teacher-roles, timetable, report-card-templates) are not logged despite a viewer existing for admins |
| **Placeholder UI** | Landing page (`src/app/page.tsx`) shows a disabled "Coming Soon" card for Student web login · `src/components/schoolsync/theme.tsx` + `src/lib/schoolsync/types.ts` are an orphaned prototype theming layer, imported nowhere in the live app, with a `School` type shape incompatible with the real Prisma model · `public/` only contains default Next.js placeholder SVGs (no real brand assets uploaded yet) |
| **Planned / Implied but absent** | Parent web portal (full API exists, zero UI/route) · Student web portal (explicitly marked "Coming Soon" on the landing page) · Founder/platform-admin portal (no code, schema, or role references it anywhere) · Push/email/SMS notifications (Announcements are in-app/API-only today) · Automated testing of any kind |

---

## 11. Technical Debt

### Critical / Security
- **`GET /api/health` is completely unauthenticated** (`src/app/api/health/route.ts`) and exposes user count, masked emails of every registered user, and a bcrypt password-test oracle via `?email=&password=` query params. This is a credential-enumeration/brute-force vector reachable by anyone and should be locked down or removed before relying on this app being internet-facing in its current form.
- **`GET /api/schools/[schoolId]/arrangements`** has no tenant-ownership check at all — only an implicit "is logged in" check — unlike every sibling list endpoint, so a guessed `schoolId` may leak cross-tenant substitution data.
- **`GET /api/school-by-slug/[slug]`** only checks that *some* session exists, not that the caller belongs to that school — any authenticated user can resolve any other tenant's id/name/slug.
- **`GET /api/parent/fees/[paymentId]/receipt`** accepts *any* web-session user who passes the generic `canAccessSchool` check, not just guardians of that specific student — worth confirming this breadth is intended.
- **Weak admin check in `/api/ai-insights`**: privilege is computed as "does a `User` row with this id have this `schoolId`" rather than an explicit role comparison — could be wider than intended depending on where `User.schoolId` gets populated elsewhere.
- Three separate JWT systems (NextAuth, mobile, parent) all sign with the same `NEXTAUTH_SECRET` rather than dedicated secrets per system — a smell, not (yet) a proven exploit.

### Duplicated / inconsistent logic
- **Route gating duplicated**: `src/middleware.ts` and `src/lib/auth.config.ts`'s `callbacks.authorized` independently reimplement the same public-route allowlist and role-redirect rules.
- **Tenant-access checks duplicated**: ~15+ older route files define their own local `canAccess`-style closure instead of importing the shared `canAccessSchool`/`canWriteSchool` from `src/lib/tenant.ts` — a future policy change (e.g. Vice-Principal nuance) won't automatically apply everywhere.
- **Inconsistent write-tier requirements**: `exam-schemes/[schemeId]/results` POST (marks submission) only requires read-tier `canAccessSchool`, not `canWriteSchool`, unlike almost every other mutation route. `schools/[schoolId]/route.ts` GET allows admins but PUT is owner-only, an undocumented asymmetry. `schools/[schoolId]/invites` restricts both GET and POST to owner-only while most admin-mutation routes allow `SCHOOL_ADMIN`/`VICE_PRINCIPAL` via `canWriteSchool`.
- **Inconsistent teacher mobile-auth coverage** — see [§9](#9-mobile-integration) — looks like a partially migrated auth layer rather than an intentional restriction.
- **Two parallel homework-status models** (`HomeworkStudentStatus`, `HomeworkSubmission`) with near-duplicate fields that three different write paths must keep in sync by hand.
- **`POST /api/schools/[schoolId]/attendance` is a dead endpoint** — validates its body then unconditionally returns 403; superseded by teacher-portal-specific routes and never removed.
- **Homework DELETE is a soft-cancel** (`status: CANCELLED`), inconsistent with most other "DELETE" endpoints in the app being hard deletes.
- **`students/bulk` and `teachers/bulk`** hand-roll validation with manual `String(...)` casts instead of sharing a `zod` schema with the single-record creation routes.

### Dead code / leftover artifacts
- `src/lib/schoolsync/types.ts` and `src/components/schoolsync/theme.tsx` — an orphaned prototype/scaffold (the file's own header literally says "Drop this file into your real codebase as a single source of truth"), with a `School` interface shape incompatible with the real Prisma model. Not imported by the live app except by each other.
- `vercel.json` appears to be a stale parallel deploy config — git history and `amplify.yml` confirm AWS Amplify is the real, wired-up target.
- `@neondatabase/serverless` + `@prisma/adapter-neon` remain in `package.json` after the project migrated to `@prisma/adapter-pg`/RDS (`321fb9b Switch from Neon to PrismaPg adapter for RDS`).
- Redundant env var pairs: `AUTH_SECRET`/`NEXTAUTH_SECRET` and `AUTH_URL`/`NEXTAUTH_URL` are both read in places — a leftover from the NextAuth v4→v5 rename.

### Missing abstractions / process gaps
- **Zero automated tests** anywhere in the repo — no Jest/Vitest/Playwright config, no `*.test.ts`, nothing — across ~106 API routes and the tenant-isolation invariants that depend on every route remembering to scope by `schoolId`.
- **Teacher custom-RBAC is unenforced** — full schema + CRUD exists but no business route consults it, and the teacher portal nav (`TeacherSidebar.tsx`) shows every nav item to every teacher regardless of granted permissions.
- **White-labeling doesn't reach the authenticated app** — only the public login screen reads per-school branding.
- No background job/cron infrastructure — the "auto-absent" and "auto-generate arrangements" routines are synchronous, manually-triggered HTTP calls, not scheduled jobs.

### Performance / scale considerations
- PDF generation is a hand-rolled minimal writer with no image embedding — fine for current text-only report cards/receipts, but a real constraint if logos/signatures/stamps need to render as actual images rather than text references.
- No rate limiting observed anywhere (notably relevant for `/api/health`, AI Insights' Anthropic calls, and login endpoints).
- `students/bulk` / `teachers/bulk` process rows without batching/transaction chunking visible in the inventoried routes — worth checking behavior at large import sizes.

---

## 12. Future Roadmap

Inferred from schema groundwork, naming, and gaps observed (not confirmed plans):

- **Enforce the Teacher Custom RBAC layer** — the schema/API/permission-catalog work is done; the obvious next step is wiring `teacherHasPermission`/`getTeacherScope` into the actual business routes and making `TeacherSidebar.tsx` permission-aware.
- **Founder / platform-admin portal** — explicitly asked about in onboarding scope and conspicuously absent; a cross-school oversight role would need a new `UserRole` value (or a separate actor type entirely, mirroring how `Student`/`Guardian` are separate from `User`) plus its own route tree and APIs.
- **Full white-label theming** — `SchoolProvider`/`useSchool` in `src/components/schoolsync/theme.tsx` is a ready-made (if currently disconnected) extension point for propagating `primaryColor`/`logoUrl` into the authenticated dashboard/teacher chrome; reconciling its `School` type with the real Prisma model would unlock this without inventing a new mechanism.
- **Parent and Student web portals** — both have complete read/write API surfaces and zero UI; building `/parent/*` and `/student/*` page trees mirroring `/teacher/*`'s pattern is a natural next step.
- **Push/email/SMS notifications** beyond in-app `Announcement` rows.
- **Mobile parity for teachers** — closing the gap so mentor attendance, leave requests, marks entry, homework grading, and report-card actions work from the mobile JWT path, not just web sessions.
- **Automated testing** — there is currently none; introducing it is a prerequisite for safely touching the tenant-isolation-sensitive route layer at scale.
- **Payment gateway abstraction** — Razorpay/INR is hardcoded; multi-currency/multi-gateway support would require generalizing `src/lib/razorpay.ts` and `money.ts`.
- **Refresh tokens / shorter-lived mobile JWTs** with a renewal flow, and rate limiting on auth and AI-insight endpoints.
- **Consolidation cleanup**: removing the dead `schoolsync/` prototype folder, the unused Neon adapter dependencies, the redundant `AUTH_*`/`NEXTAUTH_*` env var pairs, and the duplicated tenant-check closures in favor of the shared `tenant.ts` helpers.

---

## 13. Development Workflow

**Branch strategy:** Trunk-based with short-lived `feature/*` branches merged into `main` (e.g. `feature/teacher-roles-permissions`, `feature/report-card-builder`, `feature/student-mobile-apis`, `feature/white-label-branding`), but discipline is inconsistent — some features go through a proper merge commit (`441c09a Merge branch 'feature/teacher-roles-permissions'`), while long runs of other commits land directly on `main`. No conventional-commit prefixes (`feat:`/`fix:`) — plain imperative English messages, with a rough patch of low-quality messages from an earlier debugging spree (`"NEW CHANGES"`, `"FIXED THHE LOGIN"`, `"fied ogin"`) during initial Amplify-deployment troubleshooting.

**Migration workflow:** Prisma migrations under `prisma/migrations/`, named `<UTC timestamp>_<description>`, applied in 18 discrete steps from `20260413211153_init` through `20260615150000_report_card_templates`, batched by feature (e.g. three same-day migrations on 2026-04-16 for announcements/holidays/fees, leave requests, and transfers/audit). Per commit `f939fc4 Remove migrate deploy from build - run separately`, **migrations are deliberately not run as part of the Amplify build** — they're applied manually/out-of-band against the RDS instance, unlike the unused `vercel.json`'s `buildCommand` which does include `prisma migrate deploy`.

**Environment setup — variables referenced in code** (names only; no secret values were read or are reproduced here):

| Variable | Purpose | Referenced in |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `src/lib/prisma.ts`, `prisma.config.ts`, `api/health` |
| `DIRECT_URL` | Direct (non-pooled) URL for migrations | `prisma.config.ts` |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | NextAuth secret; also reused to sign mobile & parent JWTs | `src/middleware.ts`, `mobile-auth.ts`, `parent-auth.ts`, `api/health` |
| `AUTH_URL` / `NEXTAUTH_URL` | NextAuth canonical URL | `schools/[schoolId]/invites`, `api/health` |
| `ANTHROPIC_API_KEY` | Claude API key for AI Insights | `api/ai-insights` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay API credentials | `src/lib/razorpay.ts` |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies Razorpay webhook HMAC | `src/lib/razorpay.ts` |

`.env.local` at the repo root is present but empty in this checkout — populate the above for local development against your own Postgres instance and Razorpay/Anthropic test credentials.

**Build commands** (`package.json`):
```
npm run dev      # next dev — local dev server
npm run build    # next build
npm run start    # next start — serve a production build
npm run lint     # eslint
```

**Testing commands:** None exist. There is no test runner configured.

**Deployment process:** AWS Amplify is the real, live pipeline (`amplify.yml`): `preBuild` runs `npm ci` + `npx prisma generate`, writes `DATABASE_URL`/`AUTH_SECRET`/`AUTH_URL`/`ANTHROPIC_API_KEY` into `.env.production`; `build` runs `npm run build`; artifact is `.next`. Database migrations are applied separately/manually, not as part of this pipeline. `vercel.json` exists but git history (`8322b21 Fix auth session cookie for AWS Amplify production deployment`, `6aa0871 Add health check endpoint for diagnosing env vars and DB in Lambda`) confirms Amplify, not Vercel, is what's actually serving production traffic — treat `vercel.json` as stale unless told otherwise.

---

## 14. AI Handoff Summary

### Context For Another AI Assistant

**System architecture summary:** SchoolSync is a single monolithic Next.js 16 App Router application (server components + co-located API route handlers) backed by one PostgreSQL database via Prisma 7. It is a multi-tenant SaaS where one row in `School` = one tenant, and isolation is enforced entirely in application code (no DB-level RLS) via `schoolId` filtering — the helpers in `src/lib/tenant.ts` are the canonical (but not universally adopted) way to do this. Three independent, parallel auth systems exist side by side: NextAuth v5 for web sessions (owner/admin/VP/teacher), a hand-rolled JWT system for mobile (staff + student), and another hand-rolled JWT system for the parent portal — all three currently sign with the same `NEXTAUTH_SECRET`.

**Important entities:** `School` (tenant root) → `User` (staff login identity) → `Teacher` (HR profile, 1:1 with User) → `Class` → `Section` → `Student`/`Guardian` (separate actor types, own passwords, not `User` rows). Academic data hangs off `Section`/`Student`: `Attendance`, `TimetableSlot`, `Homework`(+`HomeworkStudentStatus`+`HomeworkSubmission`), `ExamScheme`/`Exam`/`ExamResult`, `ReportCard`(+`ReportCardSubject`, +`ReportCardTemplate`). Operational entities: `LeaveRequest`/`TeacherEarlyLeaveRequest`/`Arrangement` (substitute automation), `FeeStructure`/`FeePayment` (Razorpay), `Announcement`, `Holiday`, `AuditLog`. New-and-unenforced: `TeacherCustomRole`/`TeacherPermission`/`TeacherRoleAssignment`.

**Critical business rules:**
- One owner per school (`School.ownerId` unique); one owned school per user (enforced in `POST /api/schools`).
- `VICE_PRINCIPAL` can read but never write (`canWriteSchool` explicitly excludes it).
- A published `ReportCard` is immutable with respect to template changes — `templateSnapshot` freezes layout/branding/grading at generation time.
- Parents/students only ever see **published** report cards, never drafts.
- The custom Teacher RBAC layer (`TeacherCustomRole` etc.) is additive and defaults to fully unrestricted when a teacher has no assignments — it must never be treated as a default-deny system without an assignment present.
- Cross-tenant login is rejected at the credential layer (a user/teacher's actual school must match the hostname-resolved tenant), but plenty of *post-login* routes do not equally rigorously check tenant ownership (see §11) — don't assume every route is tenant-safe just because login is.

**Naming conventions:** Models are PascalCase singular (`Student`, not `Students`). Route files are always `route.ts` under folders matching the URL (`[schoolId]`, `[studentId]` etc. for dynamic segments). Client-side interactive components are suffixed `Client.tsx` and co-located in their route folder rather than centralized. Lib helpers are named after their domain noun (`tenant.ts`, `homework.ts`, `arrangements.ts`) not generic names like `utils`.

**Coding patterns:**
- Server Components do direct Prisma reads; client components fetch from the app's own API routes via plain `fetch` in `useEffect`/handlers — no SWR/React Query/global store.
- Most (not all) mutation routes: `zod` parse → tenant-ownership check → Prisma write → optional `logAudit()` call.
- PDFs are generated by hand (`report-card-pdf.ts`, `receipt-pdf.ts`), not a library — don't introduce a PDF library without checking whether replacing this is in scope.
- No structured logging — `console.error` inside `catch` blocks is the only logging mechanism (Amplify/Lambda has no other sink configured).

**Multi-tenant rules:** Every new model/route touching tenant data **must** filter by `schoolId`, and should use `src/lib/tenant.ts`'s helpers (or extend them) rather than writing a new local ownership closure — the codebase already has ~15 instances of that anti-pattern and they're flagged as debt, not as a pattern to imitate.

**Permission rules:** Check `UserRole` first (`SCHOOL_OWNER`/`SCHOOL_ADMIN`/`VICE_PRINCIPAL`/`TEACHER`), then ownership/admin-membership via `canAccessSchool`/`canWriteSchool`. Do **not** assume `TeacherCustomRole`/`TeacherPermission` is consulted anywhere yet — if asked to "respect teacher permissions," that almost certainly means *wiring up* `teacher-permissions.ts`, since nothing currently calls `teacherHasPermission` from a business route.

**Existing features:** See [§10](#10-current-implemented-features) — broadly, the admin/owner web app and the underlying data model are mature and feature-complete; parent/student access is API-only with no web UI; teacher mobile coverage is partial; white-labeling only reaches the login screen.

**Planned features (inferred, not confirmed):** See [§12](#12-future-roadmap) — most likely next: RBAC enforcement, a Founder/platform-admin portal, parent/student web UIs, full white-label theming via the existing-but-disconnected `SchoolProvider`.

**Areas that must never be broken without explicit instruction:**
- Tenant isolation (`schoolId` scoping) on every existing route — even ones using the older local-closure pattern.
- The immutability of published report cards' `templateSnapshot`.
- The "additive, default-unrestricted" semantics of the Teacher RBAC layer (don't flip it to default-deny as a side effect of "enforcing" it without the user explicitly asking for that behavior change).
- Razorpay signature verification (`timingSafeEqual`-based) — never relax to a plain string comparison.
- The cross-tenant login rejection in `auth.ts`/`mobile-auth.ts`.

**Safe places to add new code:**
- New admin features: a new folder under `src/app/dashboard/[schoolSlug]/<feature>/` with a co-located `*Client.tsx`, plus a matching `src/app/api/schools/[schoolId]/<feature>/route.ts` using `src/lib/tenant.ts` helpers.
- New shared business logic: a new file in `src/lib/` (flat, domain-named) — avoid the orphaned `src/lib/schoolsync/` subfolder, which is dead prototype code and should not be extended.
- New Prisma models: always include a `schoolId` (or transitive scoping via a parent that has one) and add it to the relevant `tenant.ts` checks.
- New mobile-accessible teacher routes: prefer `getTeacherAuth` from `src/lib/mobile-auth.ts` over a raw `auth()` session check, to keep mobile/web parity from regressing further.
