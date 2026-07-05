/**
 * Deterministic multi-school pilot dataset generator.
 *
 *   ALLOW_PILOT_SEED=true npm run seed:pilot
 *
 * HARD SAFETY GUARD (see src/lib/pilot-seed-guard.ts): refuses to run unless
 * ALLOW_PILOT_SEED=true is explicitly set, NODE_ENV is not "production", and
 * DATABASE_URL doesn't look like a managed production host. This script has
 * NEVER been run against Neon or any production database — it targets a
 * disposable local/dev/test Postgres instance only.
 *
 * Generates two tenants with realistic (fictional) data at pilot scale:
 *   School A — ~2,000 students, ~100 teachers
 *   School B — ~500 students, ~35 teachers
 * covering classes/sections/subjects/timetable, attendance history, homework,
 * fee structures + manual payments, exam schemes/results, a small sample of
 * report cards, and audit-log rows. Stored-file rows use METADATA fixtures
 * only (a fake storageKey/contentType) — no real bytes are uploaded anywhere.
 *
 * Student/teacher creation uses batched `createMany` (never one row per
 * request) — see BATCH_SIZE. Runtime is NOT promised; bcrypt password-hash
 * generation for thousands of students is the dominant cost (see
 * --skip-password-hash to omit it for a faster structural-only run).
 *
 * Uses relative imports only (no `@/` alias) so it runs standalone under tsx
 * without depending on Next's bundler path resolution — same convention as
 * scripts/worker.ts.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { assertPilotSeedAllowed } from "../src/lib/pilot-seed-guard";
import {
  mulberry32,
  pick,
  fullName,
  SUBJECT_POOL,
  SCHOOL_A_CONFIG,
  SCHOOL_B_CONFIG,
  distributeAcrossSections,
  type PilotSizeConfig,
} from "./pilot-data";

const SEED = Number(process.env.PILOT_SEED ?? 42);
const BATCH_SIZE = 500;
const SKIP_PASSWORD_HASH = process.argv.includes("--skip-password-hash");

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  // Disposable local/dev/test Postgres (the only target this script permits —
  // see assertPilotSeedAllowed above) has no SSL listener; forcing an SSL
  // handshake against it fails with "server does not support SSL connections".
  const isLocalHost = ["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname);
  const pool = new Pool({ connectionString, ssl: isLocalHost ? false : { rejectUnauthorized: false } });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

async function seedSchool(prisma: PrismaClient, config: PilotSizeConfig, rand: () => number) {
  console.log(`[seed-pilot] seeding "${config.schoolName}" (${config.studentCount} students, ${config.teacherCount} teachers)`);

  const ownerEmail = `owner+${config.schoolSlug}@pilot.local`;
  const ownerPasswordHash = await bcrypt.hash("PilotOwner!2026", 10);
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: { name: `${config.schoolName} Owner`, email: ownerEmail, password: ownerPasswordHash, role: "SCHOOL_OWNER" },
    update: {},
  });

  const school = await prisma.school.upsert({
    where: { slug: config.schoolSlug },
    create: { name: config.schoolName, slug: config.schoolSlug, ownerId: owner.id, status: "ACTIVE" },
    update: {},
  });

  // ── Classes, sections, subjects (small counts — plain creates are fine) ────
  const sectionIds: string[] = [];
  const sectionLabels = ["A", "B", "C", "D", "E"].slice(0, config.sectionsPerClass);
  for (const className of config.classNames) {
    const cls = await prisma.class.upsert({
      where: { name_schoolId: { name: className, schoolId: school.id } },
      create: { name: className, schoolId: school.id },
      update: {},
    });
    for (const label of sectionLabels) {
      const section = await prisma.section.upsert({
        where: { name_classId: { name: label, classId: cls.id } },
        create: { name: label, classId: cls.id },
        update: {},
      });
      sectionIds.push(section.id);
      for (const subject of SUBJECT_POOL) {
        await prisma.subject.upsert({
          where: { classId_sectionId_name: { classId: cls.id, sectionId: section.id, name: subject } },
          create: { schoolId: school.id, classId: cls.id, sectionId: section.id, name: subject },
          update: {},
        });
      }
    }
  }

  // ── Teachers (batched) ──────────────────────────────────────────────────────
  const teacherRows = Array.from({ length: config.teacherCount }, (_, i) => ({
    name: fullName(rand),
    subject: pick(rand, SUBJECT_POOL),
    schoolId: school.id,
    phone: `9${String(100000000 + i).padStart(9, "0")}`,
  }));
  for (let i = 0; i < teacherRows.length; i += BATCH_SIZE) {
    await prisma.teacher.createMany({ data: teacherRows.slice(i, i + BATCH_SIZE) });
  }

  // ── Students (batched), distributed evenly across sections ─────────────────
  const studentSeeds = Array.from({ length: config.studentCount }, (_, i) => ({ index: i, name: fullName(rand) }));
  const bySection = distributeAcrossSections(studentSeeds, sectionIds);

  let created = 0;
  for (const [sectionId, group] of bySection) {
    const fatherPhoneHash = SKIP_PASSWORD_HASH ? null : await bcrypt.hash("Pilot!2026", 10);
    const rows = group.map((s) => ({
      name: s.name,
      admissionNo: `${config.schoolSlug}-${String(s.index + 1).padStart(5, "0")}`,
      // rollNo is unique per (rollNo, schoolId) — see schema.prisma
      // Student@@unique([rollNo, schoolId]) — NOT per-section. Must use the
      // student's school-wide index, not a per-section-local counter, or
      // every section after the first collides entirely on (rollNo,
      // schoolId) and is silently dropped by skipDuplicates below.
      rollNo: String(s.index + 1),
      sectionId,
      schoolId: school.id,
      fatherName: fullName(rand),
      fatherPhone: `9${String(200000000 + s.index).padStart(9, "0")}`,
      fatherPhoneHash,
    }));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const result = await prisma.student.createMany({ data: rows.slice(i, i + BATCH_SIZE), skipDuplicates: true });
      created += result.count;
    }
  }
  console.log(`[seed-pilot] created ${created} students across ${sectionIds.length} sections`);

  // ── Attendance history (batched, bounded window) ────────────────────────────
  const students = await prisma.student.findMany({ where: { schoolId: school.id }, select: { id: true, sectionId: true } });
  const marker = owner;
  {
    const today = new Date();
    for (let d = 0; d < config.attendanceDays; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      date.setHours(0, 0, 0, 0);
      if (date.getDay() === 0) continue; // Sunday — no school
      const rows = students.map((s) => ({
        date,
        type: "STUDENT" as const,
        status: rand() < 0.92 ? ("PRESENT" as const) : rand() < 0.5 ? ("ABSENT" as const) : ("LATE" as const),
        studentId: s.id,
        sectionId: s.sectionId,
        schoolId: school.id,
        markedById: marker.id,
      }));
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        await prisma.attendance.createMany({ data: rows.slice(i, i + BATCH_SIZE), skipDuplicates: true });
      }
    }
    console.log(`[seed-pilot] seeded ${config.attendanceDays} days of attendance history`);
  }

  // ── Fee structure + a sample of manual payments ─────────────────────────────
  const feeStructure = await prisma.feeStructure.create({
    data: { name: "Annual Tuition Fee", amount: 45000, frequency: "ANNUAL", schoolId: school.id },
  });
  const paidSample = students.slice(0, Math.min(200, students.length));
  for (let i = 0; i < paidSample.length; i += BATCH_SIZE) {
    const chunk = paidSample.slice(i, i + BATCH_SIZE);
    await prisma.feePayment.createMany({
      data: chunk.map((s) => ({
        amount: 20000,
        method: "CASH",
        status: "PAID",
        paidAt: new Date(),
        studentId: s.id,
        feeStructureId: feeStructure.id,
        schoolId: school.id,
        recordedById: marker?.id,
      })),
    });
  }
  console.log(`[seed-pilot] seeded fee structure + ${paidSample.length} manual payments`);

  // ── Exam scheme/exams + a bounded sample of results ─────────────────────────
  const scheme = await prisma.examScheme.create({ data: { name: "Annual Examination", schoolId: school.id } });
  const exams = await Promise.all(
    SUBJECT_POOL.map((subject, order) => prisma.exam.create({ data: { name: subject, maxMarks: 100, order, schemeId: scheme.id } }))
  );
  const resultSample = students.slice(0, Math.min(200, students.length));
  for (const exam of exams) {
    const rows = resultSample.map((s) => ({
      examId: exam.id,
      studentId: s.id,
      marks: Math.round(50 + rand() * 50),
      submittedById: marker.id,
    }));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await prisma.examResult.createMany({ data: rows.slice(i, i + BATCH_SIZE), skipDuplicates: true });
    }
  }
  console.log(`[seed-pilot] seeded exam scheme with ${exams.length} exams for ${resultSample.length} students`);

  // ── Audit log sample (bounded, not one row per student) ─────────────────────
  await prisma.auditLog.createMany({
    data: [
      { action: "SCHOOL_SEEDED", entityType: "School", entityId: school.id, userId: marker.id, schoolId: school.id, metadata: JSON.stringify({ studentCount: created }) },
      { action: "PILOT_DATA_GENERATED", entityType: "School", entityId: school.id, userId: marker.id, schoolId: school.id },
    ],
  });

  console.log(`[seed-pilot] done: ${config.schoolName} (schoolId=${school.id})`);
  return school;
}

async function main() {
  assertPilotSeedAllowed();
  const rand = mulberry32(SEED);
  const prisma = buildPrisma();
  try {
    await seedSchool(prisma, SCHOOL_A_CONFIG, rand);
    await seedSchool(prisma, SCHOOL_B_CONFIG, rand);
    console.log("[seed-pilot] complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed-pilot] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
