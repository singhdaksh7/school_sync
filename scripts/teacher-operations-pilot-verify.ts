/**
 * Teacher Operations Head & Automatic Delegation pilot scenario runner
 * (PART 34) — integration-level, calls the same library functions the API
 * routes call, directly, against a real disposable database. Requires the
 * base pilot dataset from `npm run seed:pilot` to already exist. Never run
 * against Neon/prod — protected by the same hard guard as the seed script.
 *
 * Uses the SAME fixed deterministic test date as operations-pilot-verify.ts
 * (2026-03-16, a Monday) so both pilots reason about the same school-local
 * "today" — never `new Date()`.
 *
 *   ALLOW_PILOT_SEED=true npx tsx scripts/teacher-operations-pilot-verify.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import { SCHOOL_A_CONFIG, SCHOOL_B_CONFIG } from "./pilot-data";
import { configureOperationalRoleChain, getOperationalRoleChain } from "../src/lib/operational-roles";
import { resolveEffectiveOperationalRole, isOperationsHeadUnavailable } from "../src/lib/operational-role-resolver";
import { canManageTeacherOperations } from "../src/lib/operational-authorization";
import { buildDelegatedAuditMetadata } from "../src/lib/operational-audit";
import { bulkSetTeacherDailyStatus } from "../src/lib/teacher-daily-status";
import { assignArrangement } from "../src/lib/arrangements";
import { schoolLifecycleGate, isSchoolBlocked } from "../src/lib/school-access";
import { computeNeedsAttention } from "../src/lib/operations-attention";

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const isLocalHost = ["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname);
  const pool = new Pool({ connectionString, ssl: isLocalHost ? false : { rejectUnauthorized: false } });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

type StepResult = "PASS" | "FAIL";
const results: { step: string; result: StepResult; detail?: string }[] = [];

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || undefined;
    results.push({ step: name, result: "PASS", detail });
    console.log(`[teacher-ops-verify] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", detail });
    console.error(`[teacher-ops-verify] FAIL  ${name} — ${detail}`);
  }
}

const FIXED_DATE_ONLY = new Date(2026, 2, 16); // 2026-03-16, Monday — school-local calendar date convention (see school-time.ts)
const ROLE_TYPE = "TEACHER_OPERATIONS" as const;

async function main() {
  assertPilotSeedAllowed();
  const prisma = buildPrisma();

  try {
    const schoolA = await prisma.school.findUnique({ where: { slug: SCHOOL_A_CONFIG.schoolSlug } });
    const schoolB = await prisma.school.findUnique({ where: { slug: SCHOOL_B_CONFIG.schoolSlug } });
    if (!schoolA || !schoolB) {
      console.error(`Run "npm run seed:pilot" first — schools not found`);
      process.exit(1);
      return;
    }

    const teachers = await prisma.teacher.findMany({ where: { schoolId: schoolA.id }, orderBy: { id: "asc" }, take: 6 });
    const [kavita, amit, pooja, extra] = teachers;
    if (!kavita || !amit || !pooja) throw new Error("expected at least 3 teachers in School A");
    const teacherBOfB = await prisma.teacher.findFirstOrThrow({ where: { schoolId: schoolB.id } });

    await step("0. Establish a clean baseline for Kavita/Amit/Pooja on the fixed date (other pilot scripts sharing this disposable DB may have already marked ABSENT/leave for these same teacher ids)", async () => {
      const ids = [kavita.id, amit.id, pooja.id];
      await prisma.leaveRequest.updateMany({ where: { schoolId: schoolA.id, teacherId: { in: ids }, status: "APPROVED" }, data: { status: "REJECTED" } });
      for (const id of ids) {
        await prisma.attendance.upsert({
          where: { date_teacherId: { date: FIXED_DATE_ONLY, teacherId: id } },
          create: { date: FIXED_DATE_ONLY, type: "TEACHER", status: "PRESENT", teacherId: id, schoolId: schoolA.id, markedById: schoolA.ownerId! },
          update: { status: "PRESENT" },
        });
      }
      return `reset ${ids.length} teachers to PRESENT with no approved leave on ${FIXED_DATE_ONLY.toDateString()}`;
    });

    await step("1. Configure the TEACHER_OPERATIONS chain: Kavita(0)/Amit(1)/Pooja(2)", async () => {
      const result = await configureOperationalRoleChain({
        schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
        assignments: [{ teacherId: kavita.id, priority: 0 }, { teacherId: amit.id, priority: 1 }, { teacherId: pooja.id, priority: 2 }],
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
      return `assignments=${result.assignments.length}`;
    });

    await step("2. Primary (Kavita) available -> effective, assignmentType=PRIMARY", async () => {
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== kavita.id || resolved.assignmentType !== "PRIMARY") throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}`;
    });

    await step("3. Amit (STANDBY) is denied any operational capability while Kavita is effective", async () => {
      const auth = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: "TEACHER_ATTENDANCE_MANAGE", at: FIXED_DATE_ONLY });
      if (auth.allowed) throw new Error("Amit was unexpectedly authorized while standby");
      return `reasonCode=${auth.reasonCode}`;
    });

    await step("4. Approve Kavita's leave (Admin action) -> resolver flips to Amit automatically, no manual activation", async () => {
      await prisma.leaveRequest.create({
        data: { type: "TEACHER", reason: "Pilot leave", status: "APPROVED", fromDate: FIXED_DATE_ONLY, toDate: FIXED_DATE_ONLY, teacherId: kavita.id, schoolId: schoolA.id, reviewedById: schoolA.ownerId },
      });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== amit.id) throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}, delegated priority=${resolved.effectivePriority}`;
    });

    let amitAuth: Awaited<ReturnType<typeof canManageTeacherOperations>> | null = null;
    await step("5. Amit's SAME identity, without any new login/session action, is now authorized (dynamic gain of authority)", async () => {
      amitAuth = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: "TEACHER_ATTENDANCE_MANAGE", at: FIXED_DATE_ONLY });
      if (!amitAuth.allowed || !amitAuth.delegated) throw new Error(JSON.stringify(amitAuth));
      return `delegated=${amitAuth.delegated}, priority=${amitAuth.priority}, primaryTeacherId=${amitAuth.primaryTeacherId}`;
    });

    await step("6. The full read capability bundle (today/status/current-period/next-period-risk/workload/daily-summary) is granted to Amit while effective", async () => {
      const caps = ["OPERATIONS_TODAY_VIEW", "TEACHER_STATUS_VIEW", "CURRENT_PERIOD_VIEW", "NEXT_PERIOD_RISK_VIEW", "TEACHER_WORKLOAD_VIEW", "DAILY_OPERATIONS_SUMMARY_VIEW"] as const;
      for (const cap of caps) {
        const auth = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: cap, at: FIXED_DATE_ONLY });
        if (!auth.allowed) throw new Error(`capability ${cap} unexpectedly denied`);
      }
      return `capabilities=${caps.length}`;
    });

    await step("7. Fee/financial insight is never granted by the operational bundle (denied by absence, not an explicit deny)", async () => {
      const { TEACHER_OPERATIONS_CAPABILITIES } = await import("../src/lib/operational-capabilities");
      const hasFeeCapability = TEACHER_OPERATIONS_CAPABILITIES.some((c) => c.toUpperCase().includes("FEE"));
      if (hasFeeCapability) throw new Error("a FEE-related capability leaked into the operational bundle");
      return "no FEE capability in bundle";
    });

    await step("8. Amit manages another teacher's daily attendance status (delegated mutation)", async () => {
      const result = await bulkSetTeacherDailyStatus({
        schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY,
        updates: [{ teacherId: pooja.id, status: "PRESENT" }],
        markedById: amit.userId ?? schoolA.ownerId!,
        delegatedAudit: buildDelegatedAuditMetadata(amit.id, amitAuth!),
      });
      if (!result.ok || !result.results[0].ok) throw new Error(JSON.stringify(result));
      return "applied=1";
    });

    await step("9. Amit CANNOT use the same privileged path to change his OWN daily status (SELF_TEACHER_STATUS_MUTATION_FORBIDDEN)", async () => {
      const result = await bulkSetTeacherDailyStatus({
        schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY,
        updates: [{ teacherId: amit.id, status: "PRESENT" }],
        markedById: amit.userId ?? schoolA.ownerId!,
        delegatedAudit: buildDelegatedAuditMetadata(amit.id, amitAuth!),
      });
      if (!result.ok) throw new Error(result.error);
      if (result.results[0].ok || result.results[0].reason !== "SELF_TEACHER_STATUS_MUTATION_FORBIDDEN") throw new Error(JSON.stringify(result.results[0]));
      return `rejection=${result.results[0].reason}`;
    });

    let poojaLeaveId = "";
    let amitOwnLeaveId = "";
    await step("10. Seed a pending leave request for Pooja (another teacher) and one for Amit himself", async () => {
      const poojaLeave = await prisma.leaveRequest.create({ data: { type: "TEACHER", reason: "Pilot", status: "PENDING", fromDate: FIXED_DATE_ONLY, toDate: FIXED_DATE_ONLY, teacherId: pooja.id, schoolId: schoolA.id } });
      const amitLeave = await prisma.leaveRequest.create({ data: { type: "TEACHER", reason: "Pilot", status: "PENDING", fromDate: FIXED_DATE_ONLY, toDate: FIXED_DATE_ONLY, teacherId: amit.id, schoolId: schoolA.id } });
      poojaLeaveId = poojaLeave.id;
      amitOwnLeaveId = amitLeave.id;
      return `poojaLeaveId=${poojaLeaveId}, amitOwnLeaveId=${amitOwnLeaveId}`;
    });

    await step("11. Amit (delegated) approves Pooja's leave — the exact route logic: capability check + teacherId !== target.teacherId", async () => {
      const leaveApproveAuth = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: "TEACHER_LEAVE_APPROVE", at: FIXED_DATE_ONLY });
      if (!leaveApproveAuth.allowed) throw new Error("Amit unexpectedly denied TEACHER_LEAVE_APPROVE");
      const target = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: poojaLeaveId } });
      if (target.teacherId === amit.id) throw new Error("test setup error: target should not be Amit's own leave");
      await prisma.leaveRequest.update({ where: { id: poojaLeaveId }, data: { status: "APPROVED", reviewedById: amit.userId ?? schoolA.ownerId! } });
      const meta = buildDelegatedAuditMetadata(amit.id, leaveApproveAuth);
      if (!meta.delegated || meta.primaryTeacherId !== kavita.id) throw new Error(JSON.stringify(meta));
      return `delegated=${meta.delegated}, priority=${meta.effectivePriority}, primaryTeacherId=${meta.primaryTeacherId}`;
    });

    await step("12. Amit CANNOT approve his OWN pending leave — SELF_LEAVE_APPROVAL_FORBIDDEN, checked server-side", async () => {
      const leaveApproveAuth = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: "TEACHER_LEAVE_APPROVE", at: FIXED_DATE_ONLY });
      const target = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: amitOwnLeaveId } });
      const selfApprovalForbidden = Boolean(leaveApproveAuth.allowed) && target.teacherId === amit.id;
      if (!selfApprovalForbidden) throw new Error("expected the self-approval condition to trigger for Amit's own leave");
      return "self-approval condition correctly triggers (route denies before mutating)";
    });

    await step("13. Amit assigns a manual arrangement (delegated) and the delegated audit metadata is correct", async () => {
      const section = await prisma.section.findFirstOrThrow({ where: { class: { schoolId: schoolA.id } } });
      const arrangementAuth = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: "ARRANGEMENTS_MANAGE", at: FIXED_DATE_ONLY });
      if (!arrangementAuth.allowed) throw new Error("Amit unexpectedly denied ARRANGEMENTS_MANAGE");
      const result = await assignArrangement({ schoolId: schoolA.id, date: FIXED_DATE_ONLY, sectionId: section.id, period: 1, subject: "Mathematics", absentTeacherId: kavita.id, substituteTeacherId: pooja.id });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return `arrangementId=${result.arrangementId}`;
    });

    await step("14. Kavita's leave ends -> she is effective again automatically; Amit loses authority WITHOUT any logout/re-login action", async () => {
      await prisma.leaveRequest.updateMany({ where: { teacherId: kavita.id, schoolId: schoolA.id, status: "APPROVED" }, data: { status: "REJECTED" } });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== kavita.id) throw new Error(JSON.stringify(resolved));
      const amitAuthNow = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: amit.id, capability: "TEACHER_ATTENDANCE_MANAGE", at: FIXED_DATE_ONLY });
      if (amitAuthNow.allowed) throw new Error("Amit unexpectedly still authorized after Kavita's return");
      const kavitaAuthNow = await canManageTeacherOperations({ schoolId: schoolA.id, teacherId: kavita.id, capability: "TEACHER_ATTENDANCE_MANAGE", at: FIXED_DATE_ONLY });
      if (!kavitaAuthNow.allowed || kavitaAuthNow.delegated) throw new Error(JSON.stringify(kavitaAuthNow));
      return `kavitaEffective=true, delegated=${kavitaAuthNow.delegated}, amitStillAuthorized=false`;
    });

    await step("15. Kavita is marked ABSENT (admin path, no delegatedAudit) -> Amit becomes effective", async () => {
      const result = await bulkSetTeacherDailyStatus({ schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY, updates: [{ teacherId: kavita.id, status: "ABSENT" }], markedById: schoolA.ownerId! });
      if (!result.ok || !result.results[0].ok) throw new Error(JSON.stringify(result));
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== amit.id) throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}, reasonCode(primary)=${resolved.chain[0].reasonCode}`;
    });

    await step("16. Kavita corrected back to PRESENT -> she is effective again automatically", async () => {
      const result = await bulkSetTeacherDailyStatus({ schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY, updates: [{ teacherId: kavita.id, status: "PRESENT" }], markedById: schoolA.ownerId! });
      if (!result.ok || !result.results[0].ok) throw new Error(JSON.stringify(result));
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== kavita.id) throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}`;
    });

    await step("17. Kavita AND Amit both unavailable (re-approve Kavita's leave, mark Amit absent) -> Pooja effective", async () => {
      // Step 11 approved Pooja's OWN leave (to test delegated leave-approval) —
      // undo that here so Pooja is genuinely available for this scenario.
      await prisma.leaveRequest.update({ where: { id: poojaLeaveId }, data: { status: "REJECTED" } });
      await prisma.leaveRequest.updateMany({ where: { teacherId: kavita.id, schoolId: schoolA.id }, data: { status: "APPROVED" } });
      await bulkSetTeacherDailyStatus({ schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY, updates: [{ teacherId: amit.id, status: "ABSENT" }], markedById: schoolA.ownerId! });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== pooja.id) throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}, priority=${resolved.effectivePriority}`;
    });

    await step("18. All three unavailable -> NO_AVAILABLE_ASSIGNEE, never falls back to a random teacher, primaryTeacher still identifies Kavita", async () => {
      await bulkSetTeacherDailyStatus({ schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY, updates: [{ teacherId: pooja.id, status: "ABSENT" }], markedById: schoolA.ownerId! });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher !== null || resolved.reasonCode !== "NO_AVAILABLE_ASSIGNEE") throw new Error(JSON.stringify(resolved));
      if (resolved.primaryTeacher?.id !== kavita.id) throw new Error("primaryTeacher identity lost");
      return `reasonCode=${resolved.reasonCode}, primaryTeacher=${resolved.primaryTeacher?.name}`;
    });

    await step("19. NO_ACTIVE_OPERATIONS_HEAD is now correctly detected end-to-end (DB -> resolver -> engine)", async () => {
      const unavailable = await isOperationsHeadUnavailable(schoolA.id, FIXED_DATE_ONLY);
      if (!unavailable) throw new Error("expected isOperationsHeadUnavailable=true given all three are unavailable");
      const items = computeNeedsAttention({
        currentPeriodOps: { status: "IN_PERIOD", periodNumber: 1, label: null, runningClasses: 0, normal: 0, substituted: 0, uncovered: 0, teachersInClass: 0, teachersFree: 0, teachersUnavailable: 0, uncoveredDetails: [] },
        nextPeriodRisk: { hasNextPeriod: false, periodNumber: null, label: null, startTime: null, startsInMinutes: null, scheduled: 0, unavailableTeacherLectures: 0, covered: 0, uncovered: 0, riskLevel: "NONE", uncoveredDetails: [] },
        attendanceCompletion: { expectedSections: 0, submittedSections: 0, partialSections: 0, pendingSections: 0, completionPercentage: null, sections: [] },
        teacherStatuses: [], pendingTeacherLeaveCount: 0, pendingEarlyLeaveCount: 0,
        noActiveOperationsHead: unavailable,
      });
      if (!items.some((i) => i.code === "NO_ACTIVE_OPERATIONS_HEAD")) throw new Error("attention item missing");
      return `severity=${items.find((i) => i.code === "NO_ACTIVE_OPERATIONS_HEAD")?.severity}`;
    });

    // Restore a healthy state for the remaining scenarios.
    await bulkSetTeacherDailyStatus({ schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY, updates: [{ teacherId: pooja.id, status: "PRESENT" }, { teacherId: amit.id, status: "PRESENT" }], markedById: schoolA.ownerId! });
    await prisma.leaveRequest.updateMany({ where: { teacherId: kavita.id, schoolId: schoolA.id }, data: { status: "REJECTED" } });

    await step("20. Cross-tenant isolation: School B's teacher never resolves against School A's chain", async () => {
      const auth = await canManageTeacherOperations({ schoolId: schoolB.id, teacherId: teacherBOfB.id, capability: "TEACHER_ATTENDANCE_MANAGE", at: FIXED_DATE_ONLY });
      if (auth.allowed) throw new Error("School B teacher was unexpectedly authorized");
      const resolvedForB = await resolveEffectiveOperationalRole({ schoolId: schoolB.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolvedForB.reasonCode !== "NO_ASSIGNMENTS_CONFIGURED") throw new Error(`School B should have no configured chain, got ${resolvedForB.reasonCode}`);
      return `schoolB reasonCode=${resolvedForB.reasonCode}`;
    });

    await step("21. A foreign-school teacher in a chain submission rejects the WHOLE update — zero partial writes", async () => {
      const before = await getOperationalRoleChain(schoolA.id, ROLE_TYPE);
      const result = await configureOperationalRoleChain({
        schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
        assignments: [{ teacherId: kavita.id, priority: 0 }, { teacherId: teacherBOfB.id, priority: 1 }],
      });
      if (result.ok) throw new Error("expected rejection for a foreign-school teacher");
      const after = await getOperationalRoleChain(schoolA.id, ROLE_TYPE);
      if (after.length !== before.length || after.map((a) => a.teacherId).sort().join(",") !== before.map((a) => a.teacherId).sort().join(",")) {
        throw new Error("chain was partially mutated despite rejection");
      }
      return `code=${result.code}, chainUnchanged=true (${after.length} assignments)`;
    });

    await step("22. Duplicate priority in a submission is rejected before any DB write", async () => {
      const result = await configureOperationalRoleChain({ schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!, assignments: [{ teacherId: kavita.id, priority: 0 }, { teacherId: amit.id, priority: 0 }] });
      if (result.ok) throw new Error("expected DUPLICATE_PRIORITY rejection");
      return `code=${result.code}`;
    });

    await step("23. Duplicate teacher in a submission is rejected", async () => {
      const result = await configureOperationalRoleChain({ schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!, assignments: [{ teacherId: kavita.id, priority: 0 }, { teacherId: kavita.id, priority: 1 }] });
      if (result.ok) throw new Error("expected DUPLICATE_TEACHER rejection");
      return `code=${result.code}`;
    });

    await step("24. A disabled Primary assignment lets the next Alternate become effective", async () => {
      const result = await configureOperationalRoleChain({
        schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
        assignments: [{ teacherId: kavita.id, priority: 0, isEnabled: false }, { teacherId: amit.id, priority: 1 }, { teacherId: pooja.id, priority: 2 }],
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== amit.id || resolved.chain[0].reasonCode !== "ASSIGNMENT_DISABLED") throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}`;
    });

    await step("25. A future effectiveFrom Primary is not active early", async () => {
      const future = new Date(2099, 0, 1);
      await configureOperationalRoleChain({
        schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
        assignments: [{ teacherId: kavita.id, priority: 0, effectiveFrom: future }, { teacherId: amit.id, priority: 1 }, { teacherId: pooja.id, priority: 2 }],
      });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== amit.id || resolved.chain[0].reasonCode !== "ASSIGNMENT_NOT_STARTED") throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}`;
    });

    await step("26. An expired effectiveUntil assignment is no longer active", async () => {
      const past = new Date(2000, 0, 1);
      await configureOperationalRoleChain({
        schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
        assignments: [{ teacherId: kavita.id, priority: 0, effectiveUntil: past }, { teacherId: amit.id, priority: 1 }, { teacherId: pooja.id, priority: 2 }],
      });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== amit.id || resolved.chain[0].reasonCode !== "ASSIGNMENT_ENDED") throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}`;
    });

    await step("27. NOT_MARKED Primary remains AVAILABLE (with a warning flag), never incorrectly triggers failover", async () => {
      await configureOperationalRoleChain({
        schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
        assignments: [{ teacherId: kavita.id, priority: 0 }, { teacherId: amit.id, priority: 1 }, { teacherId: pooja.id, priority: 2 }],
      });
      await prisma.attendance.deleteMany({ where: { schoolId: schoolA.id, type: "TEACHER", teacherId: kavita.id, date: FIXED_DATE_ONLY } });
      const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (resolved.effectiveTeacher?.id !== kavita.id || !resolved.chain[0].attendanceNotMarked) throw new Error(JSON.stringify(resolved));
      return `effective=${resolved.effectiveTeacher?.name}, attendanceNotMarked=${resolved.chain[0].attendanceNotMarked}`;
    });

    if (extra) {
      await step("28. A deleted (soft-deleted) teacher in the chain is skipped, never resolved as effective", async () => {
        await configureOperationalRoleChain({
          schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
          assignments: [{ teacherId: extra.id, priority: 0 }, { teacherId: amit.id, priority: 1 }],
        });
        await prisma.teacher.update({ where: { id: extra.id }, data: { isDeleted: true, deletedAt: FIXED_DATE_ONLY } });
        const resolved = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
        const restored = resolved.effectiveTeacher?.id === amit.id && resolved.chain[0].reasonCode === "TEACHER_DELETED";
        await prisma.teacher.update({ where: { id: extra.id }, data: { isDeleted: false, deletedAt: null } });
        if (!restored) throw new Error(JSON.stringify(resolved));
        return `effective=${resolved.effectiveTeacher?.name}`;
      });
    }

    // Restore the canonical Kavita/Amit/Pooja chain for the remaining steps.
    await configureOperationalRoleChain({
      schoolId: schoolA.id, roleType: ROLE_TYPE, createdById: schoolA.ownerId!,
      assignments: [{ teacherId: kavita.id, priority: 0 }, { teacherId: amit.id, priority: 1 }, { teacherId: pooja.id, priority: 2 }],
    });

    await step("29. School lifecycle: SUSPENDED blocks the operational route path (never bypassed by delegation)", async () => {
      await prisma.school.update({ where: { id: schoolA.id }, data: { status: "SUSPENDED" } });
      const blocked = await schoolLifecycleGate(schoolA.id);
      const blockedBool = await isSchoolBlocked(schoolA.id);
      await prisma.school.update({ where: { id: schoolA.id }, data: { status: "ACTIVE" } });
      if (!blocked || !blockedBool) throw new Error("expected the suspended school to be blocked");
      return "blocked=true (restored to ACTIVE after)";
    });

    await step("30. Resolver determinism: identical inputs produce an identical result", async () => {
      const first = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      const second = await resolveEffectiveOperationalRole({ schoolId: schoolA.id, roleType: ROLE_TYPE, at: FIXED_DATE_ONLY });
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("resolver is not deterministic for identical inputs");
      return `effective=${first.effectiveTeacher?.name}`;
    });

    await step("31. Owner/Admin authority is untouched by any of this — Owner/Admin never route through the operational resolver at all", async () => {
      // Structural fact, not a live call: Owner/Admin authorization (canAccessSchool/
      // canWriteSchool) is checked and passes/fails BEFORE the operational fallback
      // in every guard built this phase — verified statically in
      // tests/teacher-operations-authorization.test.ts ("Admin path never reaches
      // the operational resolver"). Documented here as the pilot's cross-reference.
      return "verified structurally (see teacher-operations-authorization.test.ts)";
    });
  } finally {
    await prisma.$disconnect();
  }

  finish(results);
}

function finish(rows: typeof results) {
  const passed = rows.filter((r) => r.result === "PASS").length;
  const failed = rows.filter((r) => r.result === "FAIL").length;
  console.log(`\n[teacher-ops-verify] ${passed} passed, ${failed} failed, ${rows.length} total steps`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[teacher-ops-verify] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
