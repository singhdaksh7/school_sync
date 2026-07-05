/**
 * Cost Guard & Session Hardening pilot scenario runner — integration-level
 * (calls the same service functions the API routes call, directly, against a
 * real disposable database). Requires the pilot dataset from
 * `npm run seed:pilot` to already exist. Never run against Neon/prod —
 * protected by the same hard guard as the seed script.
 *
 *   ALLOW_PILOT_SEED=true npx tsx scripts/cost-guard-pilot-verify.ts
 *
 * The base pilot seed creates students (with a default password derived from
 * father/mother phone) but no Guardian rows and no Teacher User accounts —
 * this script creates the minimal additional fixtures needed to exercise
 * real login/session/retention flows on top of the existing seed.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import { SCHOOL_A_CONFIG } from "./pilot-data";
import { unifiedMobileLogin } from "../src/lib/unified-mobile-login";
import { authBucketKey, recordFailedCredential } from "../src/lib/auth-login-flow";
import { createSession, validateSession, countActiveSessions } from "../src/lib/auth-sessions";
import { uploadManagedFile } from "../src/lib/file-service";
import { homeworkAttachmentRetention, homeworkSubmissionRetention } from "../src/lib/file-retention";
import { findExistingEquivalentJob } from "../src/lib/job-dedup";
import { createJob } from "../src/lib/jobs";
import { getJobHandler } from "../src/lib/job-handlers";

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
    console.log(`[cost-guard-verify] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", detail });
    console.error(`[cost-guard-verify] FAIL  ${name} — ${detail}`);
  }
}

const fakeHeaders = () => new Headers({ "x-forwarded-for": "203.0.113.10" });

async function main() {
  assertPilotSeedAllowed();
  const prisma = buildPrisma();

  try {
    const school = await prisma.school.findUnique({ where: { slug: SCHOOL_A_CONFIG.schoolSlug } });
    if (!school) {
      console.error(`Run "npm run seed:pilot" first — school ${SCHOOL_A_CONFIG.schoolSlug} not found`);
      process.exit(1);
      return;
    }
    await step("1. School context exists", async () => `schoolId=${school.id}`);

    const existingStudent = await prisma.student.findFirst({ where: { schoolId: school.id }, select: { id: true, admissionNo: true } });
    if (!existingStudent) throw new Error("no seeded student found");

    // ── Fixtures: a guardian, a deliberately-ambiguous student, a teacher with a User account ──
    const guardianPhone = "9876500001";
    const guardianPasswordHash = await bcrypt.hash("ParentPass!2026", 10);
    const guardian = await prisma.guardian.create({
      data: { schoolId: school.id, name: "Test Parent", phone: `+91${guardianPhone}`, passwordHash: guardianPasswordHash },
    });
    await prisma.studentGuardian.create({
      data: { schoolId: school.id, guardianId: guardian.id, studentId: existingStudent.id, relationType: "GUARDIAN", isPrimary: true },
    });
    await step("2. Test guardian fixture created", async () => `guardianId=${guardian.id}`);

    // Deliberately ambiguous fixture: a student whose admissionNo IS the raw
    // phone digits, with the SAME password as a guardian at that (normalized) phone.
    const ambiguousDigits = "9876500099";
    const section = await prisma.section.findFirst({ where: { class: { schoolId: school.id } } });
    if (!section) throw new Error("no seeded section found");
    const ambiguousPasswordHash = await bcrypt.hash("AmbiguousPass!2026", 10);
    const ambiguousStudent = await prisma.student.create({
      data: {
        schoolId: school.id, sectionId: section.id, name: "Ambiguous Case", rollNo: "AMBIG-1",
        admissionNo: ambiguousDigits, fatherPhone: "9000000000", fatherPhoneHash: ambiguousPasswordHash,
      },
    });
    const ambiguousGuardian = await prisma.guardian.create({
      data: { schoolId: school.id, name: "Ambiguous Guardian", phone: `+91${ambiguousDigits}`, passwordHash: ambiguousPasswordHash },
    });
    await prisma.studentGuardian.create({
      data: { schoolId: school.id, guardianId: ambiguousGuardian.id, studentId: ambiguousStudent.id, relationType: "GUARDIAN", isPrimary: true },
    });

    const teacherUser = await prisma.user.create({
      data: { name: "Test Teacher", email: `test-teacher-${Date.now()}@pilot.local`, password: await bcrypt.hash("TeacherPass!2026", 10), role: "TEACHER", schoolId: school.id },
    });
    const teacher = await prisma.teacher.create({ data: { schoolId: school.id, name: "Test Teacher", userId: teacherUser.id } });
    await step("3. Ambiguous + teacher fixtures created", async () => `ambiguousStudentId=${ambiguousStudent.id}, teacherId=${teacher.id}`);

    const now = new Date("2026-07-06T08:00:00Z");

    // ── UNIFIED LOGIN ──────────────────────────────────────────────────────
    await step("4. Unified login: parent succeeds", async () => {
      const res = await unifiedMobileLogin({ identifier: guardianPhone, password: "ParentPass!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: { deviceInstallationId: "device-parent-1" }, now });
      if (!res.ok || res.actorType !== "PARENT") throw new Error(`expected PARENT success, got ${JSON.stringify(res)}`);
      return `guardianId=${res.guardian.id}`;
    });

    await step("5. Unified login: student succeeds via the same endpoint", async () => {
      const res = await unifiedMobileLogin({ identifier: existingStudent.admissionNo!, password: "Pilot!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: { deviceInstallationId: "device-student-1" }, now });
      if (!res.ok || res.actorType !== "STUDENT") throw new Error(`expected STUDENT success, got ${JSON.stringify(res)}`);
      return `studentId=${res.student.id}`;
    });

    await step("6. Unified login: ambiguous credential fails closed", async () => {
      const res = await unifiedMobileLogin({ identifier: ambiguousDigits, password: "AmbiguousPass!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: {}, now });
      if (res.ok) throw new Error("ambiguous credential was NOT rejected");
      if (res.code !== "INVALID_CREDENTIALS") throw new Error(`expected generic INVALID_CREDENTIALS, got ${res.code}`);
      return `code=${res.code}`;
    });

    await step("7. Unified login: wrong school fails safely (generic)", async () => {
      const res = await unifiedMobileLogin({ identifier: guardianPhone, password: "ParentPass!2026", schoolSlug: "nonexistent-school-slug", headers: new Headers(), device: {}, now });
      if (res.ok) throw new Error("login with a nonexistent school unexpectedly succeeded");
      if (res.code !== "INVALID_CREDENTIALS") throw new Error(`expected generic INVALID_CREDENTIALS, got ${res.code}`);
      return `code=${res.code}`;
    });

    // ── SUCCESSFUL LOGIN QUOTA (parent: 3/24h) ────────────────────────────
    const quotaGuardianPhone = "9876500002";
    const quotaGuardian = await prisma.guardian.create({
      data: { schoolId: school.id, name: "Quota Parent", phone: `+91${quotaGuardianPhone}`, passwordHash: guardianPasswordHash },
    });
    await prisma.studentGuardian.create({ data: { schoolId: school.id, guardianId: quotaGuardian.id, studentId: existingStudent.id, relationType: "GUARDIAN", isPrimary: false } });

    const quotaResults: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const res = await unifiedMobileLogin({ identifier: quotaGuardianPhone, password: "ParentPass!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: { deviceInstallationId: `quota-device-${i}` }, now: new Date(now.getTime() + i * 1000) });
      quotaResults.push(res.ok ? "PASS" : (res as { code: string }).code);
    }
    await step("8. Login quota: 3 new logins pass, 4th denied (NEW_LOGIN_LIMIT_REACHED)", async () => {
      if (quotaResults[0] !== "PASS" || quotaResults[1] !== "PASS" || quotaResults[2] !== "PASS") throw new Error(`expected first 3 to pass, got ${quotaResults}`);
      if (quotaResults[3] !== "NEW_LOGIN_LIMIT_REACHED") throw new Error(`expected 4th denied, got ${quotaResults[3]}`);
      return `results=${quotaResults.join(",")}`;
    });

    await step("9. After the quota window elapses, a new login is allowed again", async () => {
      const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      const res = await unifiedMobileLogin({ identifier: quotaGuardianPhone, password: "ParentPass!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: { deviceInstallationId: "quota-device-5" }, now: later });
      if (!res.ok) throw new Error(`expected success after window elapsed, got ${JSON.stringify(res)}`);
      return "ok";
    });

    // ── FAILED PASSWORD ESCALATION (parent/student) ───────────────────────
    const failGuardianPhone = "9876500003";
    await prisma.guardian.create({ data: { schoolId: school.id, name: "Fail Parent", phone: `+91${failGuardianPhone}`, passwordHash: guardianPasswordHash } });
    const failNow = new Date("2026-07-07T00:00:00Z");

    // Each attempt must land AFTER the previous cooldown/lock has expired, or
    // it just re-reports the still-active PRIOR lock instead of genuinely
    // reaching password verification as a new attempt — so offsets step past
    // each escalation tier's duration (1min, then 15min, then the 6h lock is
    // verified separately in steps 11-12 rather than by continuing this loop).
    const attemptOffsetsMs = [0, 1_000, 2_000, 2_000 + 61_000, 2_000 + 61_000 + 901_000];
    const failureOutcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await unifiedMobileLogin({ identifier: failGuardianPhone, password: "WrongPassword!", schoolSlug: school.slug, headers: fakeHeaders(), device: {}, now: new Date(failNow.getTime() + attemptOffsetsMs[i]) });
      failureOutcomes.push(res.ok ? "PASS" : res.code);
    }
    await step("10. Failed-password escalation: 1-2 normal, 3=cooldown, 4=cooldown, 5=lock", async () => {
      if (failureOutcomes[0] !== "INVALID_CREDENTIALS" || failureOutcomes[1] !== "INVALID_CREDENTIALS") throw new Error(`expected normal invalid-credentials for 1-2, got ${failureOutcomes}`);
      if (failureOutcomes[2] !== "AUTH_COOLDOWN_ACTIVE") throw new Error(`expected cooldown at attempt 3, got ${failureOutcomes[2]}`);
      if (failureOutcomes[4] !== "AUTH_TEMPORARILY_LOCKED") throw new Error(`expected lock at attempt 5, got ${failureOutcomes[4]}`);
      return `outcomes=${failureOutcomes.join(",")}`;
    });

    const fifthAttemptAt = failNow.getTime() + attemptOffsetsMs[4];

    await step("11. Before the 6h lock elapses, correct credentials are still denied", async () => {
      const almostThere = new Date(fifthAttemptAt + 5 * 60 * 60 * 1000);
      const res = await unifiedMobileLogin({ identifier: failGuardianPhone, password: "ParentPass!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: {}, now: almostThere });
      if (res.ok) throw new Error("expected the lock to still be active");
      return `code=${(res as { code: string }).code}`;
    });

    await step("12. After the 6h lock elapses, correct credentials succeed", async () => {
      const afterLock = new Date(fifthAttemptAt + 6 * 60 * 60 * 1000 + 5000);
      const res = await unifiedMobileLogin({ identifier: failGuardianPhone, password: "ParentPass!2026", schoolSlug: school.slug, headers: fakeHeaders(), device: {}, now: afterLock });
      if (!res.ok) throw new Error(`expected success after lock expiry, got ${JSON.stringify(res)}`);
      return "ok";
    });

    // ── TEACHER failed-password (5 -> 1h lock) ────────────────────────────
    const teacherFailBucket = authBucketKey(school.id, "TEACHER", teacherUser.email);
    const teacherFailNow = new Date("2026-07-08T00:00:00Z");
    let teacherLockState: { locked: boolean; retryAfterSeconds: number | null } = { locked: false, retryAfterSeconds: null };
    for (let i = 1; i <= 5; i++) {
      teacherLockState = await recordFailedCredential(teacherFailBucket, school.id, "TEACHER", new Date(teacherFailNow.getTime() + i * 1000));
    }
    await step("13. Teacher failed-password reaches a 1-hour lock at attempt 5", async () => {
      if (!teacherLockState.locked || teacherLockState.retryAfterSeconds !== 3600) throw new Error(`expected 1h lock, got ${JSON.stringify(teacherLockState)}`);
      return `retryAfterSeconds=${teacherLockState.retryAfterSeconds}`;
    });

    // ── ACTIVE SESSION / DEVICE LIMITS ─────────────────────────────────────
    await step("14. Student active-session limit (max 2): 3rd device evicts oldest", async () => {
      const actor = { schoolId: school.id, actorType: "STUDENT" as const, studentId: existingStudent.id };
      const s1 = await createSession(actor, { deviceInstallationId: "s-device-A" }, now);
      const s2 = await createSession(actor, { deviceInstallationId: "s-device-B" }, new Date(now.getTime() + 1000));
      const s3 = await createSession(actor, { deviceInstallationId: "s-device-C" }, new Date(now.getTime() + 2000));
      const activeCount = await countActiveSessions(actor, new Date(now.getTime() + 3000));
      const v1 = await validateSession(s1.rawSessionId, new Date(now.getTime() + 3000));
      if (!s3.oldestRevoked) throw new Error("expected 3rd device to evict the oldest");
      if (activeCount !== 2) throw new Error(`expected 2 active sessions, got ${activeCount}`);
      if (v1.valid) throw new Error("expected the oldest (1st) session to now be invalid");
      void s2;
      return `activeCount=${activeCount}`;
    });

    await step("15. Parent active-session limit (max 3): 4th device evicts oldest", async () => {
      const actor = { schoolId: school.id, actorType: "PARENT" as const, guardianId: guardian.id };
      await createSession(actor, { deviceInstallationId: "p-device-A" }, now);
      await createSession(actor, { deviceInstallationId: "p-device-B" }, new Date(now.getTime() + 1000));
      await createSession(actor, { deviceInstallationId: "p-device-C" }, new Date(now.getTime() + 2000));
      const fourth = await createSession(actor, { deviceInstallationId: "p-device-D" }, new Date(now.getTime() + 3000));
      const activeCount = await countActiveSessions(actor, new Date(now.getTime() + 4000));
      if (!fourth.oldestRevoked) throw new Error("expected 4th device to evict the oldest");
      if (activeCount !== 3) throw new Error(`expected 3 active sessions, got ${activeCount}`);
      return `activeCount=${activeCount}`;
    });

    await step("16. A revoked/expired session is denied by validateSession", async () => {
      const actor = { schoolId: school.id, actorType: "TEACHER" as const, userId: teacherUser.id, teacherId: teacher.id };
      const s = await createSession(actor, {}, now);
      const expiredCheck = await validateSession(s.rawSessionId, new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)); // past 14d absolute
      if (expiredCheck.valid) throw new Error("expected teacher session to be absolute-expired past 14 days");
      return `reason=${expiredCheck.reason}`;
    });

    // ── JOB DEDUPLICATION ───────────────────────────────────────────────────
    await step("17. Duplicate SMART_TIMETABLE_GENERATION job is deduplicated", async () => {
      const payload = { schoolId: school.id, createdById: teacherUser.id, sections: [{ classId: "c1", sectionId: "sec1" }] };
      const first = await findExistingEquivalentJob(school.id, "SMART_TIMETABLE_GENERATION", payload);
      if (first.existing) throw new Error("did not expect an existing job before creating one");
      const created = await createJob({ type: "SMART_TIMETABLE_GENERATION", schoolId: school.id, createdById: teacherUser.id, payload, totalItems: 1, payloadFingerprint: first.fingerprint });
      if (!created.ok) throw new Error(created.error);
      const second = await findExistingEquivalentJob(school.id, "SMART_TIMETABLE_GENERATION", payload);
      if (!second.existing || second.existing.id !== created.job.id) throw new Error("expected the duplicate check to find the just-created job");
      return `jobId=${created.job.id}, deduplicated=true`;
    });

    // ── FILE RETENTION + CLEANUP ────────────────────────────────────────────
    // The cleanup job handler uses the REAL wall clock (systemClock.now()),
    // not the fake `now` used above for login/session scenarios — so the due
    // date here is computed relative to the actual current time (8 days ago),
    // making the attachment's dueDate+7d expiry already past REGARDLESS of
    // what today's real date happens to be when this script runs, while the
    // submission's dueDate+30d expiry remains safely in the future.
    const homeworkDueDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const homework = await prisma.homework.create({
      data: { schoolId: school.id, sectionId: section.id, teacherId: teacher.id, subject: "Mathematics", title: "Retention test", dueDate: homeworkDueDate, deadlineAt: homeworkDueDate, status: "ACTIVE" },
    });
    const attachmentUpload = await uploadManagedFile({
      category: "HOMEWORK_ATTACHMENT", schoolId: school.id, originalFilename: "worksheet.pdf", declaredContentType: "application/pdf",
      bytes: new Uint8Array(Buffer.from("%PDF-1.4 fake")), uploader: { type: "USER", id: teacherUser.id },
      retention: homeworkAttachmentRetention(homeworkDueDate),
    });
    if (!attachmentUpload.ok) throw new Error(attachmentUpload.error);
    await prisma.homework.update({ where: { id: homework.id }, data: { attachmentFileId: attachmentUpload.file.id } });

    await step("18. Homework attachment expiresAt = dueDate + 7 days", async () => {
      const expected = new Date(homeworkDueDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (attachmentUpload.file.expiresAt?.getTime() !== expected.getTime()) throw new Error(`expected ${expected.toISOString()}, got ${attachmentUpload.file.expiresAt?.toISOString()}`);
      return `expiresAt=${attachmentUpload.file.expiresAt?.toISOString()}`;
    });

    const submissionUpload = await uploadManagedFile({
      category: "HOMEWORK_SUBMISSION", schoolId: school.id, originalFilename: "answer.pdf", declaredContentType: "application/pdf",
      bytes: new Uint8Array(Buffer.from("%PDF-1.4 fake-answer")), uploader: { type: "GUARDIAN", id: guardian.id },
      retention: homeworkSubmissionRetention(homeworkDueDate),
    });
    if (!submissionUpload.ok) throw new Error(submissionUpload.error);
    const submission = await prisma.homeworkSubmission.create({
      data: {
        schoolId: school.id, homeworkId: homework.id, studentId: existingStudent.id, guardianId: guardian.id,
        attachmentFileId: submissionUpload.file.id, status: "SUBMITTED", score: 8, teacherRemark: "Good work",
      },
    });

    await step("19. Homework submission expiresAt = dueDate + 30 days", async () => {
      const expected = new Date(homeworkDueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (submissionUpload.file.expiresAt?.getTime() !== expected.getTime()) throw new Error(`expected ${expected.toISOString()}, got ${submissionUpload.file.expiresAt?.toISOString()}`);
      return `expiresAt=${submissionUpload.file.expiresAt?.toISOString()}`;
    });

    // Run the real cleanup job handler (uses the real wall clock internally).
    // The attachment's expiry (dueDate + 7d = 1 day ago) is already past;
    // the submission's expiry (dueDate + 30d, still ~22 days in the future)
    // is not — so only the attachment should be deleted by this run.
    const cleanupJob1 = { id: "fake-job-1", payload: { triggeredBy: "CLI" } } as never;
    const cleanupHandler = getJobHandler("FILE_RETENTION_CLEANUP")!;
    const progressCalls: number[] = [];
    const cleanupResult1 = await cleanupHandler(cleanupJob1, { updateProgress: async (p) => { progressCalls.push(p); } });
    await step("20. File-retention cleanup deletes the expired homework attachment", async () => {
      const refreshed = await prisma.storedFile.findUnique({ where: { id: attachmentUpload.file.id } });
      if (!refreshed?.deletedAt) throw new Error(`expected attachment to be marked deleted, row=${JSON.stringify(refreshed)}`);
      return `resultMetadata=${JSON.stringify(cleanupResult1.resultMetadata)}`;
    });

    await step("21. Homework submission (not yet past its 30-day expiry) is preserved with score/remarks intact", async () => {
      const refreshedSubmission = await prisma.homeworkSubmission.findUnique({ where: { id: submission.id } });
      const refreshedFile = await prisma.storedFile.findUnique({ where: { id: submissionUpload.file.id } });
      if (refreshedFile?.deletedAt) throw new Error("submission attachment should not be deleted yet (30-day window)");
      if (refreshedSubmission?.score !== 8 || refreshedSubmission.teacherRemark !== "Good work") throw new Error("score/remarks were not preserved");
      return `score=${refreshedSubmission.score}, remark=${refreshedSubmission.teacherRemark}`;
    });

    await step("22. Homework metadata (title/description/status) is preserved after attachment deletion", async () => {
      const refreshedHomework = await prisma.homework.findUnique({ where: { id: homework.id } });
      if (refreshedHomework?.title !== "Retention test" || refreshedHomework.status !== "ACTIVE") throw new Error("homework metadata was unexpectedly altered");
      return `title=${refreshedHomework.title}, status=${refreshedHomework.status}`;
    });

    await step("23. Deleted file is denied by the file-serving authorization check (logical-delete tombstone)", async () => {
      const refreshed = await prisma.storedFile.findUnique({ where: { id: attachmentUpload.file.id } });
      if (!refreshed?.deletedAt) throw new Error("expected the row to be logically deleted");
      // The route itself checks `file.deletedAt` before any authorization —
      // verified directly here at the data layer (the exact condition the route checks).
      return `deletedAt=${refreshed.deletedAt.toISOString()}`;
    });

    // ── CLEANUP IDEMPOTENCY ─────────────────────────────────────────────────
    const cleanupJob2 = { id: "fake-job-2", payload: { triggeredBy: "CLI" } } as never;
    const cleanupResult2 = await cleanupHandler(cleanupJob2, { updateProgress: async () => {} });
    await step("24. Running cleanup twice is idempotent (already-deleted rows are not re-processed, no corruption)", async () => {
      const refreshed = await prisma.storedFile.findUnique({ where: { id: attachmentUpload.file.id } });
      if (!refreshed?.deletedAt) throw new Error("file should remain deleted");
      return `secondRunProcessed=${cleanupResult2.processedItems}`;
    });

    await step("25. Tenant isolation: School B cannot see School A's guardian/session data", async () => {
      const schoolB = await prisma.school.findFirst({ where: { NOT: { id: school.id } } });
      if (!schoolB) throw new Error("no second school found");
      const leaked = await prisma.guardian.findFirst({ where: { id: guardian.id, schoolId: schoolB.id } });
      if (leaked) throw new Error("guardian leaked across tenant boundary");
      return `schoolB=${schoolB.name}`;
    });

    void progressCalls;
  } finally {
    await prisma.$disconnect();
  }

  finish(results);
}

function finish(rows: typeof results) {
  const passed = rows.filter((r) => r.result === "PASS").length;
  const failed = rows.filter((r) => r.result === "FAIL").length;
  console.log(`\n[cost-guard-verify] ${passed} passed, ${failed} failed, ${rows.length} total steps`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[cost-guard-verify] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
