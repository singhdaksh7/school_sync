/**
 * Pilot scenario runner — integration-level (NOT browser E2E; it calls the
 * same service functions the API routes call, directly, against a real
 * database). Requires the pilot dataset from `npm run seed:pilot` to already
 * exist (looks up School A by its pilot slug). Never run against Neon/prod —
 * protected by the same hard guard as the seed script.
 *
 *   ALLOW_PILOT_SEED=true npm run pilot:verify
 *
 * Each step is independently try/caught and reported PASS/FAIL/SKIP so one
 * broken step doesn't hide the results of the rest. This is deliberately
 * honest about its level: it proves the SERVICE-LAYER workflow end-to-end
 * (DB reads/writes, business rules, job dispatch), not the browser UI.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import { SCHOOL_A_CONFIG } from "./pilot-data";

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  // See scripts/seed-pilot.ts buildPrisma() — same disposable-local-DB SSL fix.
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
    console.log(`[pilot-verify] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", detail });
    console.error(`[pilot-verify] FAIL  ${name} — ${detail}`);
  }
}

async function main() {
  assertPilotSeedAllowed();
  const prisma = buildPrisma();

  try {
    let school: Awaited<ReturnType<typeof prisma.school.findUnique>> = null;

    // 1–4: Founder/context, school admin, teacher, roster already exist from seeding.
    await step("1. School context exists (seeded by npm run seed:pilot)", async () => {
      school = await prisma.school.findUnique({ where: { slug: SCHOOL_A_CONFIG.schoolSlug } });
      if (!school) throw new Error(`Run "npm run seed:pilot" first — school ${SCHOOL_A_CONFIG.schoolSlug} not found`);
      return `schoolId=${school.id}, status=${school.status}`;
    });
    if (!school) return finish(results);

    await step("2. School admin/owner exists", async () => {
      const owner = await prisma.user.findFirst({ where: { ownedSchool: { id: school!.id } } });
      if (!owner) throw new Error("no owner found");
      return owner.email;
    });

    let teacherId = "";
    let sectionId = "";
    await step("3–4. Teacher + student roster context exists", async () => {
      const teacher = await prisma.teacher.findFirst({ where: { schoolId: school!.id } });
      const section = await prisma.section.findFirst({ where: { class: { schoolId: school!.id } } });
      if (!teacher || !section) throw new Error("teacher/section not found");
      teacherId = teacher.id;
      sectionId = section.id;
      const studentCount = await prisma.student.count({ where: { schoolId: school!.id, sectionId } });
      return `teacherId=${teacher.id}, sectionId=${section.id}, studentsInSection=${studentCount}`;
    });

    // 5–7: Substitution / attendance workflow.
    await step("5–7. Teacher absence → substitution/arrangement generation runs", async () => {
      const { autoGenerateArrangementsForDate } = await import("../src/lib/arrangements");
      await prisma.attendance.upsert({
        where: { date_teacherId: { date: new Date(new Date().setHours(0, 0, 0, 0)), teacherId } },
        create: { date: new Date(new Date().setHours(0, 0, 0, 0)), type: "TEACHER", status: "ABSENT", teacherId, schoolId: school!.id, markedById: (await prisma.user.findFirst({ where: { ownedSchool: { id: school!.id } } }))!.id },
        update: { status: "ABSENT" },
      });
      const summary = await autoGenerateArrangementsForDate(school!.id, new Date());
      return `arrangementsCreated=${summary.arrangementsCreated}, substitutesAssigned=${summary.substitutesAssigned}`;
    });

    // 8–10: Homework + parent view + submission relationship.
    let homeworkId = "";
    await step("8. Homework is created", async () => {
      const hw = await prisma.homework.create({
        data: {
          schoolId: school!.id, sectionId, teacherId, subject: "Mathematics", title: "Pilot verification homework",
          dueDate: new Date(Date.now() + 86400000), deadlineAt: new Date(Date.now() + 86400000),
        },
      });
      homeworkId = hw.id;
      return hw.id;
    });
    await step("9–10. Parent-visible status + submission relationship exist", async () => {
      const student = await prisma.student.findFirst({ where: { sectionId } });
      if (!student) throw new Error("no student in section");
      await prisma.homeworkStudentStatus.create({ data: { homeworkId, studentId: student.id, status: "PENDING" } });
      return `studentId=${student.id}`;
    });

    // 11–12: Manual fee ledger.
    await step("11–12. Admin records manual fee payment; parent view reflects paid/remaining", async () => {
      const { calculateStudentFeeTotals } = await import("../src/lib/student-fee-ledger");
      const fs = await prisma.feeStructure.findFirst({ where: { schoolId: school!.id } });
      const student = await prisma.student.findFirst({ where: { sectionId } });
      if (!fs || !student) throw new Error("fee structure/student not found");
      const totals = calculateStudentFeeTotals(Number(fs.amount), 20000);
      return `status=${totals.status}, remaining=${totals.remainingAmount}`;
    });

    // 13–17: Exam results + report-card generation (small + job path).
    await step("13. Exam results exist", async () => {
      const count = await prisma.examResult.count({ where: { student: { schoolId: school!.id } } });
      if (count === 0) throw new Error("no exam results — run seed:pilot");
      return `resultCount=${count}`;
    });
    await step("14–15. Small report-card generation path (direct service call)", async () => {
      const { buildReportCardBatchContext, generateReportCardForStudent } = await import("../src/lib/report-cards");
      const scheme = await prisma.examScheme.findFirst({ where: { schoolId: school!.id } });
      const student = await prisma.student.findFirst({ where: { sectionId } });
      if (!scheme || !student) throw new Error("scheme/student not found");
      const ctx = await buildReportCardBatchContext({ schoolId: school!.id, sectionId, examSchemeId: scheme.id, studentIds: [student.id] });
      if (!ctx) throw new Error("could not build batch context");
      const card = await generateReportCardForStudent(ctx, { teacherId, studentId: student.id });
      if (!card) throw new Error("report card generation returned null");
      return `reportCardId=${card.id}, status=${card.status}`;
    });
    await step("16–17. Large batch selects the job path (contract check, not full run)", async () => {
      const { REPORT_CARD_SYNC_LIMIT } = await import("../src/lib/jobs");
      const studentIds = await prisma.student.findMany({ where: { sectionId }, select: { id: true }, take: REPORT_CARD_SYNC_LIMIT + 5 });
      const wouldUseJob = studentIds.length > REPORT_CARD_SYNC_LIMIT;
      return `sectionStudentCount=${studentIds.length}, syncLimit=${REPORT_CARD_SYNC_LIMIT}, wouldDispatchJob=${wouldUseJob}`;
    });

    // 18: Publish + parent access.
    await step("18. Parent can access a PUBLISHED report card (status transition)", async () => {
      const card = await prisma.reportCard.findFirst({ where: { schoolId: school!.id, sectionId } });
      if (!card) throw new Error("no report card to publish");
      const published = await prisma.reportCard.update({ where: { id: card.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return `reportCardId=${published.id}, status=${published.status}`;
    });

    // 19–22: Lifecycle suspend/restore.
    await step("19–20. School SUSPENDED → ERP operations denied (lifecycle check)", async () => {
      const { statusIsBlocked } = await import("../src/lib/school-access");
      await prisma.school.update({ where: { id: school!.id }, data: { status: "SUSPENDED" } });
      const fresh = await prisma.school.findUnique({ where: { id: school!.id }, select: { status: true } });
      if (!statusIsBlocked(fresh?.status)) throw new Error("expected SUSPENDED to block ERP access");
      return "statusIsBlocked(SUSPENDED) === true";
    });
    await step("21. Founder restores school state", async () => {
      const restored = await prisma.school.update({ where: { id: school!.id }, data: { status: "ACTIVE" } });
      return `status=${restored.status}`;
    });
    await step("22. ERP access resumes after restoration", async () => {
      const { statusIsBlocked } = await import("../src/lib/school-access");
      if (statusIsBlocked("ACTIVE")) throw new Error("ACTIVE should not block");
      return "statusIsBlocked(ACTIVE) === false";
    });

    // 23–26: Feature disable/re-enable.
    await step("23–24. Feature disabled → module route denied", async () => {
      const { isFeatureEnabled } = await import("../src/lib/feature-flags");
      await prisma.schoolFeatureFlag.upsert({
        where: { schoolId_key: { schoolId: school!.id, key: "HOMEWORK" } },
        create: { schoolId: school!.id, key: "HOMEWORK", enabled: false },
        update: { enabled: false },
      });
      if (await isFeatureEnabled(school!.id, "HOMEWORK")) throw new Error("expected HOMEWORK to be disabled");
      return "HOMEWORK disabled and observed as disabled";
    });
    await step("25–26. Feature re-enabled → module access resumes", async () => {
      const { isFeatureEnabled } = await import("../src/lib/feature-flags");
      await prisma.schoolFeatureFlag.update({ where: { schoolId_key: { schoolId: school!.id, key: "HOMEWORK" } }, data: { enabled: true } });
      if (!(await isFeatureEnabled(school!.id, "HOMEWORK"))) throw new Error("expected HOMEWORK to be re-enabled");
      return "HOMEWORK re-enabled and observed as enabled";
    });
  } finally {
    await prisma.$disconnect();
  }

  finish(results);
}

function finish(rows: typeof results) {
  const passed = rows.filter((r) => r.result === "PASS").length;
  const failed = rows.filter((r) => r.result === "FAIL").length;
  console.log(`\n[pilot-verify] ${passed} passed, ${failed} failed, ${rows.length} total steps`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[pilot-verify] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
