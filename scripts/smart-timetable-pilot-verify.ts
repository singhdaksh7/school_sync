/**
 * Smart Timetable pilot scenario runner — integration-level (calls the same
 * service functions the API routes call, directly, against a real disposable
 * database). Requires the pilot dataset from `npm run seed:pilot` to already
 * exist. Never run against Neon/prod — protected by the same hard guard as
 * the seed script.
 *
 *   ALLOW_PILOT_SEED=true npx tsx scripts/smart-timetable-pilot-verify.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import { SCHOOL_A_CONFIG } from "./pilot-data";
import { setSubjectRequirements, getDraft, type SubjectRequirementInput } from "../src/lib/smart-timetable-drafts";
import { calculateWeeklyCapacity, validateSubjectRequirements } from "../src/lib/timetable-capacity";
import { recommendTeachers } from "../src/lib/smart-timetable-recommendations";
import { generateDraft } from "../src/lib/smart-timetable-generator";
import { generateSectionsBatch } from "../src/lib/smart-timetable-batch";
import { publishDraft } from "../src/lib/smart-timetable-publish";
import { validateDraft } from "../src/lib/smart-timetable-drafts";
import { findFreeSlotsForTeacher } from "../src/lib/timetable-recommendations";
import { autoGenerateArrangementsForDate } from "../src/lib/arrangements";

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const isLocalHost = ["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname);
  const pool = new Pool({ connectionString, ssl: isLocalHost ? false : { rejectUnauthorized: false } });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

/**
 * Resolves each { subjectName, requiredPeriodsPerWeek } entry to its
 * canonical Master Subject id for this class/section (Weekly Period
 * Requirements now require subjectId — see src/lib/master-subjects.ts).
 */
async function resolveRequirements(
  prisma: PrismaClient,
  classId: string,
  sectionId: string,
  reqs: { subjectName: string; requiredPeriodsPerWeek: number }[]
): Promise<SubjectRequirementInput[]> {
  const resolved: SubjectRequirementInput[] = [];
  for (const r of reqs) {
    const subject = await prisma.subject.findFirst({ where: { classId, sectionId, name: r.subjectName } });
    if (!subject) throw new Error(`No Master Subject "${r.subjectName}" seeded for class/section ${classId}/${sectionId}`);
    resolved.push({ subjectId: subject.id, subjectName: subject.name, requiredPeriodsPerWeek: r.requiredPeriodsPerWeek });
  }
  return resolved;
}

type StepResult = "PASS" | "FAIL" | "SKIP";
const results: { step: string; result: StepResult; detail?: string }[] = [];

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || undefined;
    results.push({ step: name, result: "PASS", detail });
    console.log(`[smart-timetable-verify] PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", detail });
    console.error(`[smart-timetable-verify] FAIL  ${name} — ${detail}`);
  }
}

const REQUIREMENTS = [
  { subjectName: "Mathematics", requiredPeriodsPerWeek: 6 },
  { subjectName: "Science", requiredPeriodsPerWeek: 6 },
  { subjectName: "English", requiredPeriodsPerWeek: 6 },
  { subjectName: "Social Studies", requiredPeriodsPerWeek: 6 },
  { subjectName: "Hindi", requiredPeriodsPerWeek: 5 },
  { subjectName: "Computer Science", requiredPeriodsPerWeek: 4 },
  { subjectName: "Physical Education", requiredPeriodsPerWeek: 3 },
]; // 6+6+6+6+5+4+3 = 36, exactly School A's 6x6 capacity

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
    await step("1. School context + timetable config exists", async () => {
      return `schoolId=${school.id}, workingDays=${school.timetableWorkingDays}, periodsPerDay=${school.periodsPerDay}`;
    });

    const cls = await prisma.class.findFirstOrThrow({ where: { schoolId: school.id, name: "10" } });
    const sections = await prisma.section.findMany({ where: { classId: cls.id }, orderBy: { name: "asc" } });
    const [sectionA, sectionB, sectionC, sectionD] = sections;
    if (!sectionA || !sectionB || !sectionC || !sectionD) throw new Error("Expected 4 sections (A-D) for Class 10");

    await step("2. Class 10 has sections A/B/C/D available", async () => `sections=${sections.map((s) => s.name).join(",")}`);

    let capacityResult: ReturnType<typeof validateSubjectRequirements> | null = null;
    await step("3. Capacity calculation is 6x6=36", async () => {
      const capacity = calculateWeeklyCapacity(school);
      if (capacity !== 36) throw new Error(`expected 36, got ${capacity}`);
      return `capacity=${capacity}`;
    });

    await step("4. Subject requirements (36 periods) validate as VALID (exact match)", async () => {
      const capacity = calculateWeeklyCapacity(school);
      capacityResult = validateSubjectRequirements(capacity, REQUIREMENTS);
      if (capacityResult.status !== "VALID") throw new Error(`expected VALID, got ${capacityResult.status}`);
      return `required=${capacityResult.required}, remaining=${capacityResult.remaining}`;
    });

    await step("5. Excess requirement is correctly flagged (diagnostic-only check, not persisted)", async () => {
      const capacity = calculateWeeklyCapacity(school);
      const excess = validateSubjectRequirements(capacity, [...REQUIREMENTS, { subjectName: "Extra", requiredPeriodsPerWeek: 5 }]);
      if (excess.status !== "EXCESS_REQUIREMENTS" || excess.remaining !== -5) throw new Error(`unexpected: ${JSON.stringify(excess)}`);
      return `status=${excess.status}, remaining=${excess.remaining}`;
    });

    for (const section of [sectionA, sectionB, sectionC, sectionD]) {
      await step(`6. Set subject requirements for 10-${section.name}`, async () => {
        const requirements = await resolveRequirements(prisma, cls.id, section.id, REQUIREMENTS);
        await setSubjectRequirements({ schoolId: school.id, classId: cls.id, sectionId: section.id, requirements });
        return `sectionId=${section.id}`;
      });
    }

    let mathRecommendationsA: Awaited<ReturnType<typeof recommendTeachers>> = [];
    await step("7. Teacher recommendations for Mathematics @ 10-A are ranked and deterministic", async () => {
      mathRecommendationsA = await recommendTeachers({
        schoolId: school.id, classId: cls.id, sectionId: sectionA.id, subjectName: "Mathematics", requiredPeriods: 6, allowConsecutive: false,
      });
      const second = await recommendTeachers({
        schoolId: school.id, classId: cls.id, sectionId: sectionA.id, subjectName: "Mathematics", requiredPeriods: 6, allowConsecutive: false,
      });
      if (mathRecommendationsA.length === 0) throw new Error("no eligible Mathematics teachers found");
      if (JSON.stringify(mathRecommendationsA) !== JSON.stringify(second)) throw new Error("recommendation ranking is not deterministic");
      for (let i = 1; i < mathRecommendationsA.length; i++) {
        if (mathRecommendationsA[i - 1].score < mathRecommendationsA[i].score) throw new Error("ranking is not score-descending");
      }
      return `candidates=${mathRecommendationsA.length}, top=${mathRecommendationsA[0].teacherName} (score=${mathRecommendationsA[0].score}, label=${mathRecommendationsA[0].label})`;
    });

    let draftAId = "";
    await step("8. Full auto-generate 10-A produces a COMPLETE, VALID draft with exact subject counts", async () => {
      const result = await generateDraft({
        schoolId: school.id, classId: cls.id, sectionId: sectionA.id, completionMode: "COMPLETE_REMAINING_ONLY", createdById: school.ownerId!,
      });
      draftAId = result.draftId;
      if (result.outcome !== "COMPLETE") throw new Error(`outcome=${result.outcome}, diagnostics=${JSON.stringify(result.diagnostics)}`);
      if (result.validationStatus !== "VALID") throw new Error(`validationStatus=${result.validationStatus}`);
      if (result.assignedCount !== 36 || result.requiredCount !== 36) throw new Error(`assigned=${result.assignedCount}, required=${result.requiredCount}`);
      return `draftId=${draftAId}, quality=${result.qualityScore}`;
    });

    await step("9. No teacher is double-booked within the 10-A draft", async () => {
      const draft = await getDraft(draftAId, school.id);
      const seen = new Set<string>();
      for (const slot of draft!.slots) {
        if (!slot.teacherId) continue;
        const key = `${slot.teacherId}-${slot.dayOfWeek}-${slot.period}`;
        if (seen.has(key)) throw new Error(`teacher ${slot.teacherId} double-booked at day ${slot.dayOfWeek} period ${slot.period}`);
        seen.add(key);
      }
      return `slots=${draft!.slots.length}, unique teacher-slot pairs=${seen.size}`;
    });

    await step("10. No class/section slot collision within the 10-A draft (36 unique day/period cells)", async () => {
      const draft = await getDraft(draftAId, school.id);
      const cells = new Set(draft!.slots.map((s) => `${s.dayOfWeek}-${s.period}`));
      if (cells.size !== 36) throw new Error(`expected 36 unique cells, got ${cells.size}`);
      return `uniqueCells=${cells.size}`;
    });

    await step("11. Every teacher used in 10-A stays within their effective max weekly workload", async () => {
      const draft = await getDraft(draftAId, school.id);
      const teacherIds = [...new Set(draft!.slots.map((s) => s.teacherId).filter((id): id is string => Boolean(id)))];
      const weeklyCounts = await prisma.timetableDraftSlot.groupBy({ by: ["teacherId"], where: { teacherId: { in: teacherIds } }, _count: { teacherId: true } });
      // Effective max fallback for this school (6x6, no overrides) = 30.
      const violations = weeklyCounts.filter((w) => (w._count.teacherId ?? 0) > 30);
      if (violations.length > 0) throw new Error(`teachers exceeding max: ${JSON.stringify(violations)}`);
      return `teachersUsed=${teacherIds.length}, maxObservedLoad=${Math.max(...weeklyCounts.map((w) => w._count.teacherId ?? 0))}`;
    });

    await step("12. Calling generateDraft again on the same input is deterministic (same assignment set)", async () => {
      const before = await getDraft(draftAId, school.id);
      const beforeSlots = JSON.stringify(before!.slots.map((s) => ({ d: s.dayOfWeek, p: s.period, t: s.teacherId, s2: s.subjectName })).sort());
      // Re-running COMPLETE_REMAINING_ONLY on an already-complete draft should be a no-op (nothing left to place).
      const result = await generateDraft({ schoolId: school.id, classId: cls.id, sectionId: sectionA.id, draftId: draftAId, completionMode: "COMPLETE_REMAINING_ONLY", createdById: school.ownerId! });
      const after = await getDraft(draftAId, school.id);
      const afterSlots = JSON.stringify(after!.slots.map((s) => ({ d: s.dayOfWeek, p: s.period, t: s.teacherId, s2: s.subjectName })).sort());
      if (beforeSlots !== afterSlots) throw new Error("re-running generation on a complete draft changed existing assignments");
      return `outcome=${result.outcome}, unchanged=${beforeSlots === afterSlots}`;
    });

    let lockedDay = 0, lockedPeriod = 0, lockedTeacherId = "";
    await step("13. Locking a slot and reoptimizing preserves it", async () => {
      const draft = await getDraft(draftAId, school.id);
      const target = draft!.slots[0];
      lockedDay = target.dayOfWeek; lockedPeriod = target.period; lockedTeacherId = target.teacherId!;
      await prisma.timetableDraftSlot.update({ where: { id: target.id }, data: { locked: true } });
      const result = await generateDraft({ schoolId: school.id, classId: cls.id, sectionId: sectionA.id, draftId: draftAId, completionMode: "REOPTIMIZE_UNLOCKED", createdById: school.ownerId! });
      const after = await getDraft(draftAId, school.id);
      const stillThere = after!.slots.find((s) => s.dayOfWeek === lockedDay && s.period === lockedPeriod);
      if (!stillThere || !stillThere.locked || stillThere.teacherId !== lockedTeacherId) {
        throw new Error("locked slot did not survive reoptimization");
      }
      return `locked day=${lockedDay} period=${lockedPeriod} preserved; outcome=${result.outcome}`;
    });

    let partialDraftId = "";
    await step("14. Partial timetable completion only fills missing periods, preserving existing ones", async () => {
      const partial = await prisma.timetableDraft.create({ data: { schoolId: school.id, classId: cls.id, sectionId: sectionB.id, createdById: school.ownerId!, source: "MANUAL", status: "DRAFT" } });
      partialDraftId = partial.id;
      const mathTeacher = mathRecommendationsA[0];
      // Manually pre-place 4 of the 6 required Mathematics periods.
      const preplaced = [
        { d: 1, p: 1 }, { d: 2, p: 1 }, { d: 3, p: 1 }, { d: 4, p: 1 },
      ];
      for (const { d, p } of preplaced) {
        await prisma.timetableDraftSlot.create({ data: { draftId: partialDraftId, dayOfWeek: d, period: p, subjectName: "Mathematics", teacherId: mathTeacher.teacherId, locked: true } });
      }
      const result = await generateDraft({ schoolId: school.id, classId: cls.id, sectionId: sectionB.id, draftId: partialDraftId, completionMode: "COMPLETE_REMAINING_ONLY", createdById: school.ownerId! });
      const after = await getDraft(partialDraftId, school.id);
      for (const { d, p } of preplaced) {
        const found = after!.slots.find((s) => s.dayOfWeek === d && s.period === p);
        if (!found || found.teacherId !== mathTeacher.teacherId) throw new Error(`pre-placed slot (${d},${p}) was not preserved`);
      }
      const mathCount = after!.slots.filter((s) => s.subjectName === "Mathematics").length;
      if (mathCount !== 6) throw new Error(`expected 6 total Mathematics periods after completion, got ${mathCount}`);
      return `preserved=${preplaced.length}, totalMathematics=${mathCount}, outcome=${result.outcome}`;
    });

    await step("15. Impossible configuration (subject with zero eligible teachers) returns useful diagnostics", async () => {
      const impossible = await prisma.timetableDraft.create({ data: { schoolId: school.id, classId: cls.id, sectionId: sectionC.id, createdById: school.ownerId!, source: "AUTO", status: "DRAFT" } });
      // "Library Studies" is deliberately not part of the seeded Master
      // Subject pool (no teacher lists it), so create a section-specific
      // Master Subject row for it here to keep this scenario valid under
      // subjectId-based enforcement while still exercising the "zero eligible
      // teacher" diagnostic path.
      const librarySubject = await prisma.subject.upsert({
        where: { classId_sectionId_name: { classId: cls.id, sectionId: sectionC.id, name: "Library Studies" } },
        create: { schoolId: school.id, classId: cls.id, sectionId: sectionC.id, name: "Library Studies" },
        update: {},
      });
      const requirements = await resolveRequirements(prisma, cls.id, sectionC.id, REQUIREMENTS);
      await setSubjectRequirements({
        schoolId: school.id, classId: cls.id, sectionId: sectionC.id,
        requirements: [...requirements, { subjectId: librarySubject.id, subjectName: librarySubject.name, requiredPeriodsPerWeek: 4 }],
      });
      // Requirements now total 40 > 36 capacity AND include a subject with no eligible teacher —
      // both a capacity problem and an eligibility problem, deliberately, to prove diagnostics surface real reasons.
      const result = await generateDraft({ schoolId: school.id, classId: cls.id, sectionId: sectionC.id, draftId: impossible.id, completionMode: "COMPLETE_REMAINING_ONLY", createdById: school.ownerId! });
      if (result.outcome !== "PARTIAL") throw new Error(`expected PARTIAL outcome, got ${result.outcome}`);
      const noEligible = result.diagnostics.find((d) => d.code === "NO_ELIGIBLE_TEACHER" && d.subjectName === "Library Studies");
      if (!noEligible) throw new Error(`expected a NO_ELIGIBLE_TEACHER diagnostic for Library Studies, got: ${JSON.stringify(result.diagnostics)}`);
      // Reset 10-C back to the normal requirement set for later steps.
      await setSubjectRequirements({ schoolId: school.id, classId: cls.id, sectionId: sectionC.id, requirements });
      return `diagnostics=${result.diagnostics.length}, sample=${noEligible.message}`;
    });

    let batchResults: Awaited<ReturnType<typeof generateSectionsBatch>>["results"] = [];
    await step("16. Multi-section batch generation ([10-C, 10-D]) shares occupancy — no cross-section teacher double-booking", async () => {
      const { results: batch } = await generateSectionsBatch({
        schoolId: school.id, createdById: school.ownerId!,
        sections: [{ classId: cls.id, sectionId: sectionC.id }, { classId: cls.id, sectionId: sectionD.id }],
      });
      batchResults = batch;
      const cSlots = (await getDraft(batch[0].draftId, school.id))!.slots;
      const dSlots = (await getDraft(batch[1].draftId, school.id))!.slots;
      const cKeys = new Set(cSlots.filter((s) => s.teacherId).map((s) => `${s.teacherId}-${s.dayOfWeek}-${s.period}`));
      const overlap = dSlots.filter((s) => s.teacherId && cKeys.has(`${s.teacherId}-${s.dayOfWeek}-${s.period}`));
      if (overlap.length > 0) throw new Error(`shared-batch teacher double-booking found: ${JSON.stringify(overlap)}`);
      const bothValid = batch.every((r) => r.validationStatus === "VALID");
      if (!bothValid) throw new Error(`expected both sections VALID, got: ${JSON.stringify(batch.map((r) => r.validationStatus))}`);
      return `sections=${batch.length}, allValid=${bothValid}, crossSectionOverlap=0`;
    });

    await step("17. Quality score is generated for a valid draft", async () => {
      const draft = await getDraft(draftAId, school.id);
      if (draft!.qualityScore === null) throw new Error("expected a non-null quality score for a VALID draft");
      return `qualityScore=${draft!.qualityScore}`;
    });

    await step("18. Publish 10-A succeeds and updates the LIVE timetable atomically", async () => {
      const result = await publishDraft({ draftId: draftAId, schoolId: school.id, publishedByUserId: school.ownerId! });
      if (!result.ok) throw new Error(`publish failed: ${result.error}`);
      const liveCount = await prisma.timetableSlot.count({ where: { schoolId: school.id, sectionId: sectionA.id } });
      if (liveCount !== 36) throw new Error(`expected 36 live slots for 10-A, got ${liveCount}`);
      return `publishedSlotCount=${result.publishedSlotCount}, liveCount=${liveCount}`;
    });

    await step("19. Teacher timetable consumer (findFreeSlotsForTeacher) reflects the published 10-A schedule", async () => {
      const draft = await getDraft(draftAId, school.id);
      const anyTeacherId = draft!.slots.find((s) => s.teacherId)!.teacherId!;
      const free = await findFreeSlotsForTeacher({ schoolId: school.id, sectionId: sectionB.id, teacherId: anyTeacherId, periodsPerDay: school.periodsPerDay, daysPerWeek: school.timetableWorkingDays });
      // This teacher now has fewer than the full 36 free slots because 10-A occupies some.
      if (free.length >= 36) throw new Error("teacher's free slots were not reduced by the published 10-A schedule");
      return `teacherId=${anyTeacherId}, freeSlotsRemaining=${free.length}`;
    });

    await step("20. Substitution/arrangement generation still operates after publish (existing system unaffected)", async () => {
      const result = await autoGenerateArrangementsForDate(school.id, new Date());
      return `dayOff=${result.dayOff}, absentTeachers=${result.absentTeachers}, arrangementsCreated=${result.arrangementsCreated}`;
    });

    await step("21. Cross-tenant isolation: School B cannot see School A's Smart Timetable drafts", async () => {
      const schoolB = await prisma.school.findFirst({ where: { NOT: { id: school.id } } });
      if (!schoolB) throw new Error("no second school found for tenant isolation check");
      const leaked = await prisma.timetableDraft.findFirst({ where: { id: draftAId, schoolId: schoolB.id } });
      if (leaked) throw new Error("School B query returned School A's draft — tenant isolation broken");
      return `schoolB=${schoolB.name}, leaked=false`;
    });

    await step("22. Publishing a draft that belongs to a different school is rejected", async () => {
      const schoolB = await prisma.school.findFirst({ where: { NOT: { id: school.id } } });
      const result = await publishDraft({ draftId: draftAId, schoolId: schoolB!.id, publishedByUserId: school.ownerId! });
      if (result.ok) throw new Error("cross-tenant publish was incorrectly allowed");
      if (result.code !== "DRAFT_NOT_FOUND") throw new Error(`expected DRAFT_NOT_FOUND, got ${result.code}`);
      return `code=${result.code}`;
    });

    await step("23. Publish revalidates server-side and blocks an invalid draft", async () => {
      const invalidDraft = await prisma.timetableDraft.create({ data: { schoolId: school.id, classId: cls.id, sectionId: sectionD.id, createdById: school.ownerId!, source: "MANUAL", status: "DRAFT" } });
      // No slots at all -> every configured requirement is unmet -> INVALID.
      const validation = await validateDraft(invalidDraft.id, school.id);
      if (validation.status !== "INVALID") throw new Error("expected an empty draft with configured requirements to be INVALID");
      const publishResult = await publishDraft({ draftId: invalidDraft.id, schoolId: school.id, publishedByUserId: school.ownerId! });
      if (publishResult.ok) throw new Error("publish incorrectly succeeded for an invalid draft");
      return `validation=${validation.status}, publishBlocked=${!publishResult.ok}, code=${publishResult.code}`;
    });

    void batchResults;
    void capacityResult;
  } finally {
    await prisma.$disconnect();
  }

  finish(results);
}

function finish(rows: typeof results) {
  const passed = rows.filter((r) => r.result === "PASS").length;
  const failed = rows.filter((r) => r.result === "FAIL").length;
  console.log(`\n[smart-timetable-verify] ${passed} passed, ${failed} failed, ${rows.length} total steps`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smart-timetable-verify] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
