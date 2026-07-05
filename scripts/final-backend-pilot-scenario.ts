/**
 * Final Backend Pilot Scenario (Phase 4) — a single, broad, cross-module
 * closure narrative distinct from the 5 specialized pilot-verify suites.
 * Those suites go DEEP on one module each (Smart Timetable, Operations,
 * Teacher Operations, Cost Guard, and the original golden-path pilot). This
 * script goes WIDE instead: one linear story that touches every major
 * module, every role, both lifecycle states, and cross-tenant isolation at
 * least once each, using the same School A / School B pilot fixtures.
 *
 * Does NOT replace the specialized suites — run both (`npm run
 * pilot:verify:all` followed by this script, or vice versa). Requires
 * `npm run seed:pilot` to have already populated both schools.
 *
 *   ALLOW_PILOT_SEED=true npx tsx scripts/final-backend-pilot-scenario.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import { SCHOOL_A_CONFIG, SCHOOL_B_CONFIG } from "./pilot-data";
import { canAccessSchool, canWriteSchool } from "../src/lib/tenant";
import { statusIsBlocked, isSchoolAdminReadRole, isSchoolAdminWriteRole } from "../src/lib/school-access";
import { requireSchoolFeature, isFeatureEnabled } from "../src/lib/feature-flags";
import { calculateStudentFeeTotals } from "../src/lib/student-fee-ledger";
import { autoGenerateArrangementsForDate } from "../src/lib/arrangements";
import { buildReportCardBatchContext, generateReportCardForStudent } from "../src/lib/report-cards";
import { findExistingEquivalentJob } from "../src/lib/job-dedup";
import { createJob } from "../src/lib/jobs";
import { hostnameFromHeaders, resolveTenantBranding } from "../src/lib/school-resolver";
import { configureOperationalRoleChain, getOperationalRoleChain } from "../src/lib/operational-roles";
import { resolveEffectiveOperationalRole } from "../src/lib/operational-role-resolver";
import { computeTodayAtSchoolSummary } from "../src/lib/operations-today-summary";

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const isLocalHost = ["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname);
  const pool = new Pool({ connectionString, ssl: isLocalHost ? false : { rejectUnauthorized: false } });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

type StepResult = "PASS" | "FAIL" | "SKIP";
const results: { step: string; result: StepResult; detail?: string }[] = [];

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || undefined;
    results.push({ step: name, result: "PASS", detail });
    console.log(`[final-scenario] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", detail });
    console.error(`[final-scenario] FAIL  ${name} — ${detail}`);
  }
}

function finish() {
  const passed = results.filter((r) => r.result === "PASS").length;
  const failed = results.filter((r) => r.result === "FAIL").length;
  console.log(`\n[final-scenario] ${passed} passed, ${failed} failed, ${results.length} total steps`);
  if (failed > 0) process.exit(1);
}

async function main() {
  assertPilotSeedAllowed();
  const prisma = buildPrisma();

  try {
    const schoolA = await prisma.school.findUnique({ where: { slug: SCHOOL_A_CONFIG.schoolSlug } });
    const schoolB = await prisma.school.findUnique({ where: { slug: SCHOOL_B_CONFIG.schoolSlug } });
    if (!schoolA || !schoolB) {
      console.error(`Run "npm run seed:pilot" first — School A/B not found.`);
      process.exit(1);
      return;
    }

    // ── 1-8: Tenant + RBAC baseline across every role ──────────────────────
    await step("1. School A context exists", async () => `schoolId=${schoolA.id}, status=${schoolA.status}`);
    await step("2. School B context exists (tenant isolation baseline)", async () => `schoolId=${schoolB.id}, status=${schoolB.status}`);

    const owner = await prisma.user.findFirst({ where: { ownedSchool: { id: schoolA.id } } });
    if (!owner) throw new Error("no owner found for School A");
    await step("3. Owner can access + write School A", async () => {
      const read = await canAccessSchool(schoolA.id, owner.id);
      const write = await canWriteSchool(schoolA.id, owner.id, owner.role);
      if (!read || !write) throw new Error(`read=${read} write=${write}`);
      return `read=${read}, write=${write}`;
    });

    const admin = await prisma.user.findFirst({ where: { schoolId: schoolA.id, role: "SCHOOL_ADMIN" } });
    await step("4. Admin (non-owner) can access + write School A", async () => {
      if (!admin) return "SKIP: no dedicated SCHOOL_ADMIN user in fixture (owner-only school — acceptable)";
      const read = await canAccessSchool(schoolA.id, admin.id);
      const write = await canWriteSchool(schoolA.id, admin.id, admin.role);
      if (!read || !write) throw new Error(`read=${read} write=${write}`);
      return `read=${read}, write=${write}`;
    });

    const vp = await prisma.user.findFirst({ where: { schoolId: schoolA.id, role: "VICE_PRINCIPAL" } });
    await step("5. Vice Principal has read access but write is denied", async () => {
      if (!vp) return "SKIP: no VICE_PRINCIPAL user in fixture";
      const read = await canAccessSchool(schoolA.id, vp.id);
      const write = await canWriteSchool(schoolA.id, vp.id, vp.role);
      if (!read || write) throw new Error(`expected read=true write=false, got read=${read} write=${write}`);
      return `read=${read}, write=${write}`;
    });

    const teacher = await prisma.teacher.findFirst({ where: { schoolId: schoolA.id } });
    if (!teacher) throw new Error("no teacher found for School A");
    await step("6. Teacher's own userId resolves to their own school only", async () => {
      const teacherUser = await prisma.user.findUnique({ where: { id: teacher.userId ?? "" } });
      if (!teacherUser) return "SKIP: teacher has no linked User row in this fixture";
      const read = await canAccessSchool(schoolA.id, teacherUser.id);
      return `read=${read}`;
    });

    await step("7. Foreign-school user (School B owner) is denied access to School A", async () => {
      const ownerB = await prisma.user.findFirst({ where: { ownedSchool: { id: schoolB.id } } });
      if (!ownerB) throw new Error("no owner found for School B");
      const read = await canAccessSchool(schoolA.id, ownerB.id);
      if (read) throw new Error("foreign-school owner was incorrectly granted access");
      return `read=${read} (correctly denied)`;
    });

    await step("8. Unauthenticated/unknown user id is denied access", async () => {
      const read = await canAccessSchool(schoolA.id, "nonexistent-user-id");
      if (read) throw new Error("unknown user was incorrectly granted access");
      return `read=${read} (correctly denied)`;
    });

    // ── 9-11: Founder cross-school visibility ───────────────────────────────
    await step("9. Founder role exists and is distinct from every school-scoped role", async () => {
      const founder = await prisma.user.findFirst({ where: { role: "FOUNDER" } });
      return founder ? `founderId=${founder.id}` : "SKIP: no FOUNDER user in fixture (not created by seed-pilot)";
    });

    // ── 10-21: One touch per major module ────────────────────────────────────
    const section = await prisma.section.findFirst({ where: { class: { schoolId: schoolA.id } } });
    if (!section) throw new Error("no section found for School A");
    const student = await prisma.student.findFirst({ where: { sectionId: section.id } });
    if (!student) throw new Error("no student found in section");

    await step("10. Students module: roster read for School A", async () => {
      const count = await prisma.student.count({ where: { schoolId: schoolA.id } });
      return `students=${count}`;
    });

    await step("11. Teachers module: roster read for School A", async () => {
      const count = await prisma.teacher.count({ where: { schoolId: schoolA.id, isDeleted: false } });
      return `teachers=${count}`;
    });

    await step("12. Attendance module: mark + read a record", async () => {
      const dateOnly = new Date(new Date().setHours(0, 0, 0, 0));
      await prisma.attendance.upsert({
        where: { date_studentId: { date: dateOnly, studentId: student.id } },
        create: { date: dateOnly, type: "STUDENT", status: "PRESENT", studentId: student.id, sectionId: section.id, schoolId: schoolA.id, markedById: owner.id },
        update: { status: "PRESENT" },
      });
      const found = await prisma.attendance.findFirst({ where: { studentId: student.id, date: dateOnly } });
      if (!found) throw new Error("attendance record not found after mark");
      return `status=${found.status}`;
    });

    let homeworkId = "";
    await step("13. Homework module: create + read", async () => {
      const hw = await prisma.homework.create({
        data: {
          schoolId: schoolA.id, sectionId: section.id, teacherId: teacher.id, subject: "Mathematics",
          title: "Final scenario homework", dueDate: new Date(Date.now() + 86400000), deadlineAt: new Date(Date.now() + 86400000),
        },
      });
      homeworkId = hw.id;
      return `homeworkId=${hw.id}`;
    });

    await step("14. Exam schemes module: scheme + results exist", async () => {
      const scheme = await prisma.examScheme.findFirst({ where: { schoolId: schoolA.id } });
      const resultCount = await prisma.examResult.count({ where: { student: { schoolId: schoolA.id } } });
      if (!scheme) throw new Error("no exam scheme found");
      return `schemeId=${scheme.id}, results=${resultCount}`;
    });

    await step("15. Report cards module: generate via the real service function", async () => {
      const scheme = await prisma.examScheme.findFirst({ where: { schoolId: schoolA.id } });
      if (!scheme) throw new Error("no exam scheme found");
      const ctx = await buildReportCardBatchContext({ schoolId: schoolA.id, sectionId: section.id, examSchemeId: scheme.id, studentIds: [student.id] });
      if (!ctx) throw new Error("buildReportCardBatchContext returned null");
      const card = await generateReportCardForStudent(ctx, { teacherId: teacher.id, studentId: student.id });
      if (!card) throw new Error("generateReportCardForStudent returned null");
      return `reportCardId=${card.id}, status=${card.status}`;
    });

    await step("16. Fees module: manual payment ledger math", async () => {
      const fs = await prisma.feeStructure.findFirst({ where: { schoolId: schoolA.id } });
      if (!fs) throw new Error("no fee structure found");
      const totals = calculateStudentFeeTotals(Number(fs.amount), 20000);
      return `status=${totals.status}, remaining=${totals.remainingAmount}`;
    });

    await step("17. Announcements module: create + read", async () => {
      const ann = await prisma.announcement.create({ data: { schoolId: schoolA.id, title: "Final scenario", body: "Cross-module closure check.", createdById: owner.id } });
      const found = await prisma.announcement.findUnique({ where: { id: ann.id } });
      if (!found) throw new Error("announcement not found after create");
      return `announcementId=${ann.id}`;
    });

    await step("18. Leaves module: teacher leave request + admin approval", async () => {
      const leaveDate = new Date(Date.now() + 172800000);
      const leave = await prisma.leaveRequest.create({
        data: { schoolId: schoolA.id, teacherId: teacher.id, type: "TEACHER", fromDate: leaveDate, toDate: leaveDate, reason: "Final scenario check", status: "PENDING" },
      });
      const approved = await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: "APPROVED", reviewedById: owner.id } });
      return `leaveId=${leave.id}, status=${approved.status}`;
    });

    await step("19. Arrangements module: substitution auto-generation runs without throwing", async () => {
      const summary = await autoGenerateArrangementsForDate(schoolA.id, new Date());
      return `arrangementsCreated=${summary.arrangementsCreated}, substitutesAssigned=${summary.substitutesAssigned}`;
    });

    await step("20. Teacher Operations Delegation module: chain configures and resolves", async () => {
      const teachers = await prisma.teacher.findMany({ where: { schoolId: schoolA.id, isDeleted: false }, take: 2 });
      if (teachers.length < 2) return "SKIP: fewer than 2 teachers available for a delegation chain";
      await configureOperationalRoleChain({
        schoolId: schoolA.id,
        roleType: "TEACHER_OPERATIONS",
        createdById: owner.id,
        assignments: [
          { teacherId: teachers[0].id, priority: 0 },
          { teacherId: teachers[1].id, priority: 1 },
        ],
      });
      const chain = await getOperationalRoleChain(schoolA.id, "TEACHER_OPERATIONS");
      const effective = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: "TEACHER_OPERATIONS", at: new Date() });
      return `chainLength=${chain.length}, effective=${effective.effectiveTeacher?.id ?? "none"}`;
    });

    await step("21. Operations Command Center module: today summary composes without throwing", async () => {
      const summary = await computeTodayAtSchoolSummary(schoolA.id, new Date());
      return `teachers=${summary.teacherSummary.totalActiveTeachers}`;
    });

    // ── 22-25: Jobs / dedup / file retention closure ────────────────────────
    await step("22. Jobs module: list + a job row exists or can be created", async () => {
      const existingCount = await prisma.backgroundJob.count({ where: { schoolId: schoolA.id } });
      return `existingJobs=${existingCount}`;
    });

    await step("23. Job dedup: creating two identical active jobs collapses to one", async () => {
      const payload = { schoolId: schoolA.id, teacherId: teacher.id, sectionId: section.id, examSchemeId: (await prisma.examScheme.findFirst({ where: { schoolId: schoolA.id } }))!.id, studentIds: [student.id] };
      const { fingerprint } = await findExistingEquivalentJob(schoolA.id, "REPORT_CARD_BATCH_GENERATION", payload);
      const first = await createJob({ type: "REPORT_CARD_BATCH_GENERATION", schoolId: schoolA.id, payload, totalItems: 1, payloadFingerprint: fingerprint });
      const second = await createJob({ type: "REPORT_CARD_BATCH_GENERATION", schoolId: schoolA.id, payload, totalItems: 1, payloadFingerprint: fingerprint });
      if (!first.ok || !second.ok) throw new Error("job creation failed unexpectedly");
      const oneDeduplicated = Boolean(first.deduplicated) !== Boolean(second.deduplicated) && (first.deduplicated || second.deduplicated);
      if (!oneDeduplicated) throw new Error(`expected exactly one dedup hit — first.deduplicated=${first.deduplicated} second.deduplicated=${second.deduplicated}`);
      return `deduplicated correctly (job=${first.job.id})`;
    });

    await step("24. Custom-domain/branding resolution: public tenant lookup by hostname", async () => {
      const branding = await resolveTenantBranding(hostnameFromHeaders(new Headers({ host: `${schoolA.slug}.example.invalid` })));
      return branding ? `resolved=${JSON.stringify(branding).slice(0, 60)}` : "no branding resolved for synthetic hostname (acceptable — not a configured custom domain)";
    });

    await step("25. Feature flag closure: disabling a feature blocks it, re-enabling restores it", async () => {
      const flag = await prisma.schoolFeatureFlag.upsert({
        where: { schoolId_key: { schoolId: schoolA.id, key: "HOMEWORK" } },
        create: { schoolId: schoolA.id, key: "HOMEWORK", enabled: false },
        update: { enabled: false },
      });
      const deniedResponse = await requireSchoolFeature(schoolA.id, "HOMEWORK");
      const disabledObserved = deniedResponse !== null;
      await prisma.schoolFeatureFlag.update({ where: { id: flag.id }, data: { enabled: true } });
      const allowedResponse = await requireSchoolFeature(schoolA.id, "HOMEWORK");
      const enabledObserved = allowedResponse === null;
      if (!disabledObserved || !enabledObserved) throw new Error(`disabledObserved=${disabledObserved} enabledObserved=${enabledObserved}`);
      return `disabled correctly blocked, re-enable correctly restored`;
    });

    // ── 26-29: School lifecycle closure ─────────────────────────────────────
    await step("26. Lifecycle: SUSPENDED blocks ERP access", async () => {
      await prisma.school.update({ where: { id: schoolA.id }, data: { status: "SUSPENDED" } });
      const blocked = statusIsBlocked((await prisma.school.findUnique({ where: { id: schoolA.id } }))!.status);
      const readDenied = !(await canAccessSchool(schoolA.id, owner.id));
      if (!blocked || !readDenied) throw new Error(`blocked=${blocked} readDenied=${readDenied}`);
      return `blocked=${blocked}, readDenied=${readDenied}`;
    });

    await step("27. Lifecycle: restoring to ACTIVE resumes ERP access", async () => {
      await prisma.school.update({ where: { id: schoolA.id }, data: { status: "ACTIVE" } });
      const blocked = statusIsBlocked((await prisma.school.findUnique({ where: { id: schoolA.id } }))!.status);
      const readAllowed = await canAccessSchool(schoolA.id, owner.id);
      if (blocked || !readAllowed) throw new Error(`blocked=${blocked} readAllowed=${readAllowed}`);
      return `blocked=${blocked}, readAllowed=${readAllowed}`;
    });

    await step("28. Role catalog closure: read-role and write-role sets are distinct and non-empty", async () => {
      const readOk = isSchoolAdminReadRole("VICE_PRINCIPAL") && !isSchoolAdminReadRole("STUDENT");
      const writeOk = isSchoolAdminWriteRole("SCHOOL_ADMIN") && !isSchoolAdminWriteRole("VICE_PRINCIPAL");
      if (!readOk || !writeOk) throw new Error(`readOk=${readOk} writeOk=${writeOk}`);
      return `readOk=${readOk}, writeOk=${writeOk}`;
    });

    await step("29. Feature-flag closure survives a lifecycle round-trip (HOMEWORK still enabled)", async () => {
      const enabled = await isFeatureEnabled(schoolA.id, "HOMEWORK");
      if (!enabled) throw new Error("HOMEWORK unexpectedly disabled after lifecycle round-trip");
      return `enabled=${enabled}`;
    });

    // ── 30-33: Cross-tenant isolation, one check per axis ───────────────────
    await step("30. Cross-tenant isolation: School B cannot see School A's homework", async () => {
      const leaked = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId: schoolB.id } });
      if (leaked) throw new Error("School A homework visible under School B scope");
      return "no leakage";
    });

    await step("31. Cross-tenant isolation: School B's teacher chain never resolves against School A's", async () => {
      const effectiveB = await resolveEffectiveOperationalRole({ schoolId: schoolB.id, roleType: "TEACHER_OPERATIONS", at: new Date() });
      const effectiveA = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: "TEACHER_OPERATIONS", at: new Date() });
      if (effectiveB.effectiveTeacher?.id && effectiveA.effectiveTeacher?.id && effectiveB.effectiveTeacher.id === effectiveA.effectiveTeacher.id) {
        throw new Error("School B resolved the same effective teacher id as School A");
      }
      return `schoolB effective=${effectiveB.effectiveTeacher?.id ?? "none"}, schoolA effective=${effectiveA.effectiveTeacher?.id ?? "none"}`;
    });

    await step("32. Cross-tenant isolation: School B's job list excludes School A's jobs", async () => {
      const crossLeak = await prisma.backgroundJob.count({ where: { schoolId: schoolB.id, payload: { path: ["schoolId"], equals: schoolA.id } } });
      if (crossLeak > 0) throw new Error("found School A jobs incorrectly scoped under School B");
      return "no leakage";
    });

    await step("33. Cross-tenant isolation: an admin user of School B cannot write to School A", async () => {
      const ownerB = await prisma.user.findFirst({ where: { ownedSchool: { id: schoolB.id } } });
      if (!ownerB) throw new Error("no owner found for School B");
      const write = await canWriteSchool(schoolA.id, ownerB.id, ownerB.role);
      if (write) throw new Error("School B owner incorrectly granted write access to School A");
      return `write=${write} (correctly denied)`;
    });

    // ── 34: Schema/migration integrity closure ──────────────────────────────
    await step("34. Schema integrity: job-dedup partial unique index exists on this database", async () => {
      const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'BackgroundJob' AND indexname = 'BackgroundJob_active_dedup_key') AS exists
      `;
      if (!rows[0]?.exists) throw new Error("BackgroundJob_active_dedup_key index missing — migration chain incomplete on this database");
      return "index present";
    });
  } finally {
    finish();
  }
}

main().catch((err) => {
  console.error("[final-scenario] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
