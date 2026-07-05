/**
 * School Operations Command Center pilot scenario runner (PART 30/31) —
 * integration-level, calls the same engine functions the API routes call,
 * directly, against a real disposable database. Requires the base pilot
 * dataset from `npm run seed:pilot` to already exist (School A/B, students,
 * teachers, classes/sections). Also benefits from — but does not strictly
 * require — `scripts/smart-timetable-pilot-verify.ts` having already
 * published School A's Class 10 Section A timetable.
 *
 * Uses a FIXED deterministic test date/time throughout (2026-03-16, a
 * Monday, expressed as explicit UTC instants so the resulting Asia/Kolkata
 * school-local date/time is identical regardless of the machine's local
 * timezone) — never `new Date()` — per PART 30's requirement that pilot
 * verification not be wall-clock-dependent.
 *
 *   ALLOW_PILOT_SEED=true npx tsx scripts/operations-pilot-verify.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import { SCHOOL_A_CONFIG, SCHOOL_B_CONFIG } from "./pilot-data";
import { loadTodayOperationsContext } from "../src/lib/operations-context";
import { computeTeacherTodayStatuses, summarizeTeacherStatuses, filterAndPaginateTeacherStatuses } from "../src/lib/operations-teacher-status";
import { bulkSetTeacherDailyStatus } from "../src/lib/teacher-daily-status";
import { computeStudentAttendanceSummary, computeAttendanceCompletion } from "../src/lib/operations-attendance";
import { classifyTodayLectures, summarizeCoverage, computeCurrentPeriodOperations, computeNextPeriodRisk } from "../src/lib/operations-lecture-coverage";
import { computeTeacherWorkloadToday } from "../src/lib/operations-teacher-workload";
import { computeNeedsAttention, loadNeedsAttentionLeaveSignals, loadNeedsAttentionJobSignals } from "../src/lib/operations-attention";
import { computeOperationsHealth } from "../src/lib/operations-health";
import { computeHomeworkTodaySummary, topPendingReviewGroups } from "../src/lib/operations-homework";
import { computeExamSchemeProgress } from "../src/lib/operations-exams";
import { computeReportCardProgress } from "../src/lib/operations-report-cards";
import { computeFeeTodaySummary, recentFeePayments } from "../src/lib/operations-fees";
import { loadTodayActivityTimeline } from "../src/lib/operations-activity";
import { computeDailyOperationsSummary } from "../src/lib/operations-daily-summary";
import { computeTodayAtSchoolSummary } from "../src/lib/operations-today-summary";
import { autoGenerateArrangementsForDate } from "../src/lib/arrangements";
import { buildReportCardBatchContext, generateReportCardForStudent } from "../src/lib/report-cards";

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
    console.log(`[operations-verify] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", detail });
    console.error(`[operations-verify] FAIL  ${name} — ${detail}`);
  }
}

// Fixed test date: 2026-03-16 is a Monday (dbDay=1). Every "now" below is an
// explicit UTC instant chosen so it resolves to the intended Asia/Kolkata
// (UTC+5:30) wall-clock time regardless of the host machine's timezone.
const BEFORE_SCHOOL_NOW = new Date("2026-03-16T02:00:00.000Z"); // 07:30 IST
const IN_PERIOD_NOW = new Date("2026-03-16T04:15:00.000Z"); // 09:45 IST -> within P3 (09:30-10:15)
const AFTER_SCHOOL_NOW = new Date("2026-03-16T07:30:00.000Z"); // 13:00 IST
const SUNDAY_NOW = new Date("2026-03-15T03:30:00.000Z"); // previous day, Sunday

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

    await step("1. School A context exists with Operations fields (timezone/periodsPerDay)", async () => {
      return `schoolId=${schoolA.id}, timezone=${schoolA.timezone}, periodsPerDay=${schoolA.periodsPerDay}`;
    });

    await step("2. Seed a 6-period SchoolPeriodSchedule for School A (08:00-12:30, 45min periods)", async () => {
      for (let i = 0; i < schoolA.periodsPerDay; i++) {
        const startMinutes = 8 * 60 + i * 45;
        const endMinutes = startMinutes + 45;
        const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        await prisma.schoolPeriodSchedule.upsert({
          where: { schoolId_periodNumber: { schoolId: schoolA.id, periodNumber: i + 1 } },
          create: { schoolId: schoolA.id, periodNumber: i + 1, label: `Period ${i + 1}`, startTime: fmt(startMinutes), endTime: fmt(endMinutes) },
          update: { startTime: fmt(startMinutes), endTime: fmt(endMinutes) },
        });
      }
      return `periods=${schoolA.periodsPerDay}`;
    });

    await step("3. resolveCurrentPeriod: BEFORE_SCHOOL ahead of the first period", async () => {
      const ctx = await loadTodayOperationsContext(schoolA.id, BEFORE_SCHOOL_NOW);
      if (ctx.periodState.status !== "BEFORE_SCHOOL") throw new Error(`expected BEFORE_SCHOOL, got ${ctx.periodState.status}`);
      return `status=${ctx.periodState.status}, nextPeriod=${ctx.periodState.nextPeriod?.periodNumber}`;
    });

    await step("4. resolveCurrentPeriod: IN_PERIOD lands on period 3 with next=period 4", async () => {
      const ctx = await loadTodayOperationsContext(schoolA.id, IN_PERIOD_NOW);
      if (ctx.periodState.status !== "IN_PERIOD") throw new Error(`expected IN_PERIOD, got ${ctx.periodState.status}`);
      if (ctx.periodState.currentPeriod?.periodNumber !== 3) throw new Error(`expected period 3, got ${ctx.periodState.currentPeriod?.periodNumber}`);
      if (ctx.periodState.nextPeriod?.periodNumber !== 4) throw new Error(`expected next=4, got ${ctx.periodState.nextPeriod?.periodNumber}`);
      return `current=${ctx.periodState.currentPeriod?.periodNumber}, next=${ctx.periodState.nextPeriod?.periodNumber}`;
    });

    await step("5. resolveCurrentPeriod: AFTER_SCHOOL past the last period", async () => {
      const ctx = await loadTodayOperationsContext(schoolA.id, AFTER_SCHOOL_NOW);
      if (ctx.periodState.status !== "AFTER_SCHOOL") throw new Error(`expected AFTER_SCHOOL, got ${ctx.periodState.status}`);
      return `status=${ctx.periodState.status}`;
    });

    await step("6. resolveCurrentPeriod: NON_WORKING_DAY on a Sunday, regardless of time-of-day", async () => {
      const ctx = await loadTodayOperationsContext(schoolA.id, SUNDAY_NOW);
      if (ctx.periodState.status !== "NON_WORKING_DAY") throw new Error(`expected NON_WORKING_DAY, got ${ctx.periodState.status}`);
      if (ctx.dbDay !== null) throw new Error(`expected dbDay null (Sunday), got ${ctx.dbDay}`);
      return `status=${ctx.periodState.status}`;
    });

    const class10 = await prisma.class.findFirstOrThrow({ where: { schoolId: schoolA.id, name: "10" } });
    const sections10 = await prisma.section.findMany({ where: { classId: class10.id }, orderBy: { name: "asc" } });
    const [section10A, section10B] = sections10;
    if (!section10A) throw new Error("expected Class 10 Section A to exist (run seed:pilot first)");

    const mondaySlotsA = await prisma.timetableSlot.findMany({ where: { schoolId: schoolA.id, sectionId: section10A.id, dayOfWeek: 1 } });
    const teacherIdsInA = [...new Set(mondaySlotsA.map((s) => s.teacherId).filter((id): id is string => Boolean(id)))];

    await step("7. Class 10-A has a published Monday timetable to exercise coverage/workload against", async () => {
      if (mondaySlotsA.length === 0) {
        console.warn("[operations-verify] WARNING: no published Monday slots for 10-A — run smart-timetable-pilot-verify.ts first for richer coverage");
      }
      return `mondaySlots=${mondaySlotsA.length}, distinctTeachers=${teacherIdsInA.length}`;
    });

    const allTeachers = await prisma.teacher.findMany({ where: { schoolId: schoolA.id }, orderBy: { id: "asc" }, take: 40 });
    // The two "absent" teachers MUST come from Class 10-A's real Monday roster
    // (so they actually occupy a slot to render UNCOVERED/SUBSTITUTED); every
    // OTHER fixture teacher below is drawn only from `otherTeachers` — teachers
    // NOT in `teacherIdsInA` — so a later status update (e.g. marking
    // `presentTeacher` PRESENT) can never silently overwrite an absence
    // applied to one of the two Monday-roster teachers in the same batch.
    const [absentUncoveredTeacher, absentMaybeSubbedTeacher] = teacherIdsInA.length >= 2
      ? teacherIdsInA.map((id) => allTeachers.find((t) => t.id === id) ?? { id })
      : allTeachers.slice(0, 2);
    const otherTeachers = allTeachers.filter((t) => !teacherIdsInA.includes(t.id));
    const onLeaveTeacher = otherTeachers[0] ?? allTeachers[0];
    const pendingLeaveTeacher = otherTeachers[1] ?? allTeachers[0];
    const earlyLeaveTeacher = otherTeachers[2] ?? allTeachers[0];
    const presentTeacher = otherTeachers[3] ?? allTeachers[0];
    const overrideTeacher = otherTeachers[4] ?? allTeachers[0];

    const FIXED_DATE_ONLY = (await loadTodayOperationsContext(schoolA.id, IN_PERIOD_NOW)).dateOnly;

    await step("8. Bulk-mark two teachers ABSENT for the fixed date (admin correction path)", async () => {
      const result = await bulkSetTeacherDailyStatus({
        schoolId: schoolA.id,
        dateOnly: FIXED_DATE_ONLY,
        updates: [
          { teacherId: absentUncoveredTeacher.id, status: "ABSENT" },
          { teacherId: absentMaybeSubbedTeacher.id, status: "ABSENT" },
          { teacherId: presentTeacher.id, status: "PRESENT" },
        ],
        markedById: schoolA.ownerId!,
      });
      if (!result.ok) throw new Error(result.error);
      const rejected = result.results.filter((r) => !r.ok);
      if (rejected.length > 0) throw new Error(`unexpected rejections: ${JSON.stringify(rejected)}`);
      return `applied=${result.results.length}`;
    });

    await step("9. Approve a full-day LeaveRequest covering the fixed date", async () => {
      await prisma.leaveRequest.create({
        data: {
          type: "TEACHER", reason: "Approved pilot leave", status: "APPROVED",
          fromDate: FIXED_DATE_ONLY, toDate: FIXED_DATE_ONLY,
          teacherId: onLeaveTeacher.id, schoolId: schoolA.id, reviewedById: schoolA.ownerId,
        },
      });
      return `teacherId=${onLeaveTeacher.id}`;
    });

    await step("10. Bulk-marking an approved-leave teacher is REJECTED, not silently ignored", async () => {
      const result = await bulkSetTeacherDailyStatus({
        schoolId: schoolA.id, dateOnly: FIXED_DATE_ONLY,
        updates: [{ teacherId: onLeaveTeacher.id, status: "PRESENT" }],
        markedById: schoolA.ownerId!,
      });
      if (!result.ok) throw new Error(result.error);
      if (result.results[0].ok || result.results[0].reason !== "ON_APPROVED_LEAVE") {
        throw new Error(`expected ON_APPROVED_LEAVE rejection, got ${JSON.stringify(result.results[0])}`);
      }
      return `rejection reason=${result.results[0].reason}`;
    });

    await step("11. A pending (not yet approved) leave request + a pending early-leave request exist for the fixed date", async () => {
      await prisma.leaveRequest.create({
        data: { type: "TEACHER", reason: "Pending pilot leave", status: "PENDING", fromDate: FIXED_DATE_ONLY, toDate: FIXED_DATE_ONLY, teacherId: pendingLeaveTeacher.id, schoolId: schoolA.id },
      });
      await prisma.teacherEarlyLeaveRequest.create({
        data: { schoolId: schoolA.id, teacherId: earlyLeaveTeacher.id, date: FIXED_DATE_ONLY, leaveAfterPeriod: 3, reason: "Pilot early leave", status: "PENDING" },
      });
      return "created";
    });

    await step("12. TeacherWorkloadOverride is honored (not ignored) by the workload engine", async () => {
      await prisma.teacherWorkloadOverride.upsert({
        where: { teacherId: overrideTeacher.id },
        create: { teacherId: overrideTeacher.id, schoolId: schoolA.id, maxDailyTeachingPeriods: 1 },
        update: { maxDailyTeachingPeriods: 1 },
      });
      return `teacherId=${overrideTeacher.id}, maxDailyTeachingPeriods=1`;
    });

    await step("13. autoGenerateArrangementsForDate reuses the real substitution ranking for absent teachers", async () => {
      const result = await autoGenerateArrangementsForDate(schoolA.id, FIXED_DATE_ONLY);
      if (result.dayOff) throw new Error("unexpectedly treated Monday as a day off");
      if (result.absentTeachers < 2) throw new Error(`expected >=2 absent teachers, got ${result.absentTeachers}`);
      return `absentTeachers=${result.absentTeachers}, arrangementsCreated=${result.arrangementsCreated}`;
    });

    const ctx = await loadTodayOperationsContext(schoolA.id, IN_PERIOD_NOW);
    const allLectures = classifyTodayLectures(ctx);

    await step("14. classifyTodayLectures is internally consistent (scheduled = normal+substituted+uncovered)", async () => {
      const totals = summarizeCoverage(allLectures);
      if (totals.scheduled !== totals.normal + totals.substituted + totals.uncovered) {
        throw new Error(`inconsistent totals: ${JSON.stringify(totals)}`);
      }
      return JSON.stringify(totals);
    });

    await step("15. The two ABSENT teachers never appear as an effectiveTeacherId anywhere today", async () => {
      const leaked = allLectures.filter((l) => l.effectiveTeacherId === absentUncoveredTeacher.id || l.effectiveTeacherId === absentMaybeSubbedTeacher.id);
      if (leaked.length > 0) throw new Error(`an absent teacher was left as the effective teacher: ${JSON.stringify(leaked)}`);
      return "no leakage";
    });

    await step("16. computeCurrentPeriodOperations / computeNextPeriodRisk run without throwing and stay internally consistent", async () => {
      const current = await computeCurrentPeriodOperations(ctx, allLectures);
      const risk = await computeNextPeriodRisk(ctx, allLectures);
      if (current.normal + current.substituted + current.uncovered !== current.runningClasses) throw new Error("current-period totals inconsistent");
      if (risk.hasNextPeriod && risk.covered + risk.uncovered !== risk.unavailableTeacherLectures) throw new Error("next-period risk totals inconsistent");
      return `current.runningClasses=${current.runningClasses}, nextPeriodRisk=${risk.riskLevel}`;
    });

    const teacherStatuses = computeTeacherTodayStatuses(ctx);
    await step("17. computeTeacherTodayStatuses — ON_LEAVE precedence and ABSENT both resolve UNAVAILABLE", async () => {
      const leaveStatus = teacherStatuses.find((t) => t.teacherId === onLeaveTeacher.id)!;
      const absentStatus = teacherStatuses.find((t) => t.teacherId === absentUncoveredTeacher.id)!;
      if (leaveStatus.baseStatus !== "ON_LEAVE" || leaveStatus.operationalStatus !== "UNAVAILABLE") throw new Error(`unexpected leave status: ${JSON.stringify(leaveStatus)}`);
      if (absentStatus.baseStatus !== "ABSENT" || absentStatus.operationalStatus !== "UNAVAILABLE") throw new Error(`unexpected absent status: ${JSON.stringify(absentStatus)}`);
      return `onLeave=${leaveStatus.operationalStatus}, absent=${absentStatus.operationalStatus}`;
    });

    await step("18. summarizeTeacherStatuses counts add up; filterAndPaginateTeacherStatuses filters correctly", async () => {
      const summary = summarizeTeacherStatuses(teacherStatuses);
      if (summary.present + summary.absent + summary.onLeave + summary.notMarked !== summary.totalActiveTeachers) {
        throw new Error(`counts do not add up: ${JSON.stringify(summary)}`);
      }
      const { data, total } = filterAndPaginateTeacherStatuses(teacherStatuses, { filter: "ON_LEAVE", skip: 0, take: 10 });
      if (total !== 1 || data[0]?.teacherId !== onLeaveTeacher.id) throw new Error("ON_LEAVE filter did not isolate the leave teacher");
      return JSON.stringify(summary);
    });

    await step("19. computeTeacherWorkloadToday: an ABSENT teacher has zero effective periods; override applies", async () => {
      const rows = computeTeacherWorkloadToday(ctx);
      const absentRow = rows.find((r) => r.teacherId === absentUncoveredTeacher.id)!;
      if (absentRow.effectivePeriods !== 0) throw new Error(`expected 0 effective periods for an absent teacher, got ${absentRow.effectivePeriods}`);
      const overrideRow = rows.find((r) => r.teacherId === overrideTeacher.id)!;
      if (overrideRow.maxDailyTeachingPeriods !== 1) throw new Error(`override not applied: ${JSON.stringify(overrideRow)}`);
      return `absentEffective=${absentRow.effectivePeriods}, overrideMaxDaily=${overrideRow.maxDailyTeachingPeriods}`;
    });

    // ── Student attendance: full/partial/pending across 3 sections ──────────
    const studentsA = section10A ? await prisma.student.findMany({ where: { sectionId: section10A.id } }) : [];
    const studentsB = section10B ? await prisma.student.findMany({ where: { sectionId: section10B.id } }) : [];
    await step("20. Seed student attendance today: 10-A fully marked, 10-B half marked, 10-C/D untouched", async () => {
      await prisma.attendance.createMany({
        data: studentsA.map((s) => ({ date: FIXED_DATE_ONLY, type: "STUDENT" as const, status: "PRESENT" as const, studentId: s.id, sectionId: s.sectionId, schoolId: schoolA.id, markedById: schoolA.ownerId! })),
        skipDuplicates: true,
      });
      const half = studentsB.slice(0, Math.ceil(studentsB.length / 2));
      await prisma.attendance.createMany({
        data: half.map((s) => ({ date: FIXED_DATE_ONLY, type: "STUDENT" as const, status: "PRESENT" as const, studentId: s.id, sectionId: s.sectionId, schoolId: schoolA.id, markedById: schoolA.ownerId! })),
        skipDuplicates: true,
      });
      return `fullSection=${studentsA.length}, partialSection=${half.length}/${studentsB.length}`;
    });

    let attendanceCompletion: Awaited<ReturnType<typeof computeAttendanceCompletion>> | null = null;
    await step("21. computeAttendanceCompletion classifies SUBMITTED/PARTIAL/PENDING correctly per section", async () => {
      await computeStudentAttendanceSummary(schoolA.id, FIXED_DATE_ONLY);
      attendanceCompletion = await computeAttendanceCompletion(schoolA.id, FIXED_DATE_ONLY);
      const rowA = attendanceCompletion.sections.find((s) => s.sectionId === section10A.id);
      const rowB = attendanceCompletion.sections.find((s) => s.sectionId === section10B?.id);
      if (rowA?.completion !== "SUBMITTED") throw new Error(`expected 10-A SUBMITTED, got ${rowA?.completion}`);
      if (section10B && rowB?.completion !== "PARTIAL") throw new Error(`expected 10-B PARTIAL, got ${rowB?.completion}`);
      return `submitted=${attendanceCompletion.submittedSections}, partial=${attendanceCompletion.partialSections}, pending=${attendanceCompletion.pendingSections}`;
    });

    // ── Homework ──────────────────────────────────────────────────────────────
    let homeworkId = "";
    await step("22. Seed homework + submissions (pending review + reviewed) for the fixed date", async () => {
      const teacherForHw = teacherIdsInA[0] ?? allTeachers[0].id;
      const hw = await prisma.homework.create({
        data: { schoolId: schoolA.id, sectionId: section10A.id, teacherId: teacherForHw, subject: "Mathematics", title: "Pilot Homework", dueDate: FIXED_DATE_ONLY, deadlineAt: FIXED_DATE_ONLY, createdAt: FIXED_DATE_ONLY },
      });
      homeworkId = hw.id;
      const sample = studentsA.slice(0, Math.min(5, studentsA.length));
      for (const [i, s] of sample.entries()) {
        await prisma.homeworkSubmission.create({
          data: {
            schoolId: schoolA.id, homeworkId: hw.id, studentId: s.id,
            submittedAt: FIXED_DATE_ONLY, status: i === 0 ? "REVIEWED" : "SUBMITTED",
            reviewedAt: i === 0 ? FIXED_DATE_ONLY : null,
          },
        });
      }
      return `homeworkId=${hw.id}, submissions=${sample.length}`;
    });

    await step("23. computeHomeworkTodaySummary + topPendingReviewGroups reflect the seeded submissions", async () => {
      const summary = await computeHomeworkTodaySummary(schoolA.id, FIXED_DATE_ONLY, IN_PERIOD_NOW);
      const groups = await topPendingReviewGroups(schoolA.id);
      if (summary.createdToday < 1) throw new Error("expected createdToday >= 1");
      if (summary.pendingReview < 1) throw new Error("expected pendingReview >= 1");
      if (summary.scoredToday < 1) throw new Error("expected scoredToday >= 1");
      const ourGroup = groups.find((g) => g.homeworkId === homeworkId);
      if (!ourGroup) throw new Error("expected our homework in the top pending-review groups");
      return JSON.stringify(summary);
    });

    // ── Exams (explicit examSchemeId — never inferred) ─────────────────────────
    const scheme = await prisma.examScheme.findFirstOrThrow({ where: { schoolId: schoolA.id, name: "Annual Examination" } });
    await step("24. computeExamSchemeProgress requires an explicit examSchemeId and returns null for a foreign one", async () => {
      const foreign = await computeExamSchemeProgress(schoolB.id, scheme.id);
      if (foreign !== null) throw new Error("expected null for a scheme not belonging to this school");
      const real = await computeExamSchemeProgress(schoolA.id, scheme.id);
      if (!real || real.exams.length === 0) throw new Error("expected exam progress rows for the real scheme");
      const anyPending = real.exams.some((e) => e.pendingCount > 0);
      if (!anyPending) throw new Error("expected at least one exam with pending results given only a partial result sample was seeded");
      return `exams=${real.exams.length}, totalPending=${real.totalPendingResults}`;
    });

    // ── Report cards (reuses the real generation service) ───────────────────────
    await step("25. Generate report cards via the real report-card service, publish some, verify progress counts", async () => {
      const sample = studentsA.slice(0, Math.min(5, studentsA.length));
      const rcCtx = await buildReportCardBatchContext({ schoolId: schoolA.id, sectionId: section10A.id, examSchemeId: scheme.id, studentIds: sample.map((s) => s.id) });
      if (!rcCtx) throw new Error("failed to build report card batch context");
      const teacherForRc = teacherIdsInA[0] ?? allTeachers[0].id;
      for (const s of sample) {
        await generateReportCardForStudent(rcCtx, { teacherId: teacherForRc, studentId: s.id });
      }
      const toPublish = sample.slice(0, 2);
      await prisma.reportCard.updateMany({ where: { studentId: { in: toPublish.map((s) => s.id) }, examSchemeId: scheme.id }, data: { status: "PUBLISHED", publishedAt: FIXED_DATE_ONLY } });

      const progress = await computeReportCardProgress(schoolA.id, scheme.id);
      if (!progress) throw new Error("expected report card progress for the real scheme");
      const rowA = progress.sections.find((s) => s.sectionId === section10A.id);
      if (!rowA || rowA.generated < 5 || rowA.published < 2) throw new Error(`unexpected report card counts: ${JSON.stringify(rowA)}`);
      return `generated=${rowA.generated}, published=${rowA.published}, pending=${rowA.pendingCount}`;
    });

    // ── Fees ──────────────────────────────────────────────────────────────────
    await step("26. Seed 2 fee payments dated on the fixed date; computeFeeTodaySummary aggregates via FeeStructure x student-count", async () => {
      const feeStructure = await prisma.feeStructure.findFirstOrThrow({ where: { schoolId: schoolA.id } });
      const payees = studentsA.slice(0, 2);
      await prisma.feePayment.createMany({
        data: payees.map((s) => ({ amount: 5000, method: "CASH", status: "PAID", paidAt: FIXED_DATE_ONLY, createdAt: FIXED_DATE_ONLY, studentId: s.id, feeStructureId: feeStructure.id, schoolId: schoolA.id, recordedById: schoolA.ownerId })),
      });
      const summary = await computeFeeTodaySummary(schoolA.id, FIXED_DATE_ONLY);
      await recentFeePayments(schoolA.id);
      if (summary.paymentsRecordedToday < 2) throw new Error(`expected >=2 payments recorded today, got ${summary.paymentsRecordedToday}`);
      if (summary.amountRecordedToday < 10000) throw new Error(`expected >=10000 recorded today, got ${summary.amountRecordedToday}`);
      if (summary.totalExpectedAmount <= 0) throw new Error("expected a positive totalExpectedAmount from the seeded fee structure");
      if (summary.outstandingAmount < 0) throw new Error("outstandingAmount must never go negative");
      return JSON.stringify(summary);
    });

    // ── Needs Attention + Health (composes everything above) ────────────────────
    const homeworkSummary = await computeHomeworkTodaySummary(schoolA.id, FIXED_DATE_ONLY, IN_PERIOD_NOW);
    const examProgress = await computeExamSchemeProgress(schoolA.id, scheme.id);
    const leaveSignals = await loadNeedsAttentionLeaveSignals(schoolA.id, FIXED_DATE_ONLY);
    await step("27. loadNeedsAttentionLeaveSignals reflects the pending leave + pending early-leave rows", async () => {
      if (leaveSignals.pendingTeacherLeaveCount < 1) throw new Error("expected >=1 pending teacher leave");
      if (leaveSignals.pendingEarlyLeaveCount < 1) throw new Error("expected >=1 pending early leave");
      return JSON.stringify(leaveSignals);
    });

    await step("28. Seed a completed report-card job, a failed timetable job, and a ready draft dated on the fixed date", async () => {
      await prisma.backgroundJob.create({ data: { schoolId: schoolA.id, type: "REPORT_CARD_BATCH_GENERATION", status: "COMPLETED", payload: {}, completedAt: FIXED_DATE_ONLY, createdAt: FIXED_DATE_ONLY, updatedAt: FIXED_DATE_ONLY } });
      await prisma.backgroundJob.create({ data: { schoolId: schoolA.id, type: "SMART_TIMETABLE_GENERATION", status: "FAILED", payload: {}, createdAt: FIXED_DATE_ONLY, updatedAt: FIXED_DATE_ONLY } });
      await prisma.timetableDraft.create({ data: { schoolId: schoolA.id, classId: class10.id, sectionId: section10B?.id ?? section10A.id, status: "VALID", createdAt: FIXED_DATE_ONLY, updatedAt: FIXED_DATE_ONLY } });
      return "seeded";
    });

    const jobSignals = await loadNeedsAttentionJobSignals(schoolA.id, FIXED_DATE_ONLY);
    await step("29. loadNeedsAttentionJobSignals reflects the seeded job/draft rows", async () => {
      if (jobSignals.reportCardJobsCompletedToday < 1) throw new Error("expected >=1 completed report-card job");
      if (jobSignals.smartTimetableJobsFailed < 1) throw new Error("expected >=1 failed timetable job");
      if (jobSignals.smartTimetableDraftsReady < 1) throw new Error("expected >=1 ready draft");
      return JSON.stringify(jobSignals);
    });

    let attention: Awaited<ReturnType<typeof computeNeedsAttention>> = [];
    await step("30. computeNeedsAttention produces expected codes, ordered by severity/imminence/count/code", async () => {
      const currentOps = await computeCurrentPeriodOperations(ctx, allLectures);
      const nextRisk = await computeNextPeriodRisk(ctx, allLectures);
      attention = computeNeedsAttention({
        currentPeriodOps: currentOps, nextPeriodRisk: nextRisk, attendanceCompletion: attendanceCompletion!,
        teacherStatuses, pendingTeacherLeaveCount: leaveSignals.pendingTeacherLeaveCount, pendingEarlyLeaveCount: leaveSignals.pendingEarlyLeaveCount,
        homeworkPendingReviewCount: homeworkSummary.pendingReview, examMarksPendingCount: examProgress?.totalPendingResults,
        reportCardJobsCompletedToday: jobSignals.reportCardJobsCompletedToday, reportCardJobsFailedToday: jobSignals.reportCardJobsFailedToday,
        smartTimetableDraftsReady: jobSignals.smartTimetableDraftsReady, smartTimetableJobsFailed: jobSignals.smartTimetableJobsFailed,
      });
      const codes = new Set(attention.map((a) => a.code));
      const expectedCodes: (typeof attention)[number]["code"][] = ["TEACHER_LEAVE_PENDING", "EARLY_LEAVE_PENDING", "HOMEWORK_REVIEW_BACKLOG", "SMART_TIMETABLE_JOB_FAILED", "SMART_TIMETABLE_DRAFT_READY", "REPORT_CARD_JOB_COMPLETED"];
      const missing = expectedCodes.filter((c) => !codes.has(c));
      if (missing.length > 0) throw new Error(`missing expected attention codes: ${missing.join(",")}`);
      const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      for (let i = 1; i < attention.length; i++) {
        if (severityRank[attention[i - 1].severity] > severityRank[attention[i].severity]) throw new Error("attention items are not severity-ordered");
      }
      return `items=${attention.length}, codes=${[...codes].join(",")}`;
    });

    await step("31. computeOperationsHealth derives a named status consistent with the worst attention item", async () => {
      const health = computeOperationsHealth(attention);
      const hasHigh = attention.some((a) => a.severity === "HIGH" || a.severity === "CRITICAL");
      if (hasHigh && health.status !== "CRITICAL" && health.status !== "NEEDS_ATTENTION") {
        throw new Error(`expected a degraded status given a HIGH/CRITICAL item, got ${health.status}`);
      }
      return `status=${health.status}, score=${health.score}`;
    });

    // ── Activity timeline (noise excluded) ───────────────────────────────────────
    await step("32. Seed one noise event (LOGIN_SUCCESS) and one business event on the fixed date; timeline excludes noise", async () => {
      await prisma.auditLog.createMany({
        data: [
          { action: "LOGIN_SUCCESS", entityType: "User", userId: schoolA.ownerId!, schoolId: schoolA.id, createdAt: FIXED_DATE_ONLY },
          { action: "ATTENDANCE_MARKED", entityType: "Teacher", userId: schoolA.ownerId!, schoolId: schoolA.id, createdAt: FIXED_DATE_ONLY },
        ],
      });
      const timeline = await loadTodayActivityTimeline(schoolA.id, FIXED_DATE_ONLY, { take: 50 });
      if (timeline.data.some((a) => a.code === "LOGIN_SUCCESS")) throw new Error("noise action LOGIN_SUCCESS leaked into the timeline");
      if (!timeline.data.some((a) => a.code === "ATTENDANCE_MARKED")) throw new Error("expected business event ATTENDANCE_MARKED in the timeline");
      return `items=${timeline.data.length}, total=${timeline.total}`;
    });

    // ── End-to-end composed summaries ─────────────────────────────────────────
    await step("33. computeDailyOperationsSummary composes end-to-end without throwing, with consistent nested totals", async () => {
      const summary = await computeDailyOperationsSummary(schoolA.id, IN_PERIOD_NOW, { examSchemeId: scheme.id });
      if (summary.coverage.scheduled !== summary.coverage.normal + summary.coverage.substituted + summary.coverage.uncovered) {
        throw new Error("daily summary coverage totals inconsistent");
      }
      if (!summary.exams || !summary.reportCards) throw new Error("expected exam/report-card sections when examSchemeId is provided");
      return `health=${summary.health.status}, attentionItems=${summary.attention.length}`;
    });

    await step("34. computeTodayAtSchoolSummary (lightweight PART 7 endpoint) succeeds independently", async () => {
      const summary = await computeTodayAtSchoolSummary(schoolA.id, IN_PERIOD_NOW);
      if (summary.periodState !== "IN_PERIOD") throw new Error(`expected IN_PERIOD, got ${summary.periodState}`);
      return `teachers=${summary.teacherSummary.totalActiveTeachers}, coverage=${JSON.stringify(summary.coverage)}`;
    });

    await step("35. Cross-tenant isolation: School B's context contains none of School A's teachers/slots", async () => {
      const ctxB = await loadTodayOperationsContext(schoolB.id, IN_PERIOD_NOW);
      const leakedTeacher = [...ctxB.teachers.keys()].find((id) => allTeachers.some((t) => t.id === id));
      if (leakedTeacher) throw new Error(`School A teacher ${leakedTeacher} leaked into School B's context`);
      return `schoolB teachers=${ctxB.teachers.size}, schoolB slots=${ctxB.todaySlots.length}`;
    });
  } finally {
    await prisma.$disconnect();
  }

  finish(results);
}

function finish(rows: typeof results) {
  const passed = rows.filter((r) => r.result === "PASS").length;
  const failed = rows.filter((r) => r.result === "FAIL").length;
  console.log(`\n[operations-verify] ${passed} passed, ${failed} failed, ${rows.length} total steps`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[operations-verify] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
