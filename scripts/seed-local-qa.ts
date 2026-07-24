/**
 * NOT part of the committed seed tooling (yet) — created ad hoc for manual
 * browser QA of PR #39 (role dashboards + Guardian portal) against a local
 * disposable Postgres instance only. Do not point this at anything but
 * localhost.
 *
 * Creates one school with a known account for each of the 6 portals
 * (Founder, School Owner, School Admin, Teacher, Student, Guardian), plus
 * two guardian-linked children (siblings) with enough attendance/homework/
 * marks/fees/timetable/report-card/announcement data for every dashboard
 * section to render non-empty.
 *
 * Usage: npx tsx scripts/seed-local-qa.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const HASH_COST = 10;

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const isLocalHost = ["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname);
  if (!isLocalHost) {
    throw new Error("seed-local-qa refuses to run against a non-localhost DATABASE_URL");
  }
  const pool = new Pool({ connectionString, ssl: false });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

async function main() {
  const prisma = buildPrisma();
  const hash = (s: string) => bcrypt.hash(s, HASH_COST);

  try {
    // ── School + Owner ────────────────────────────────────────────────────
    const ownerPassword = "Owner@Qa2026!";
    const owner = await prisma.user.upsert({
      where: { email: "owner@qa.local" },
      create: { name: "Priya Owner", email: "owner@qa.local", password: await hash(ownerPassword), role: "SCHOOL_OWNER" },
      update: {},
    });

    const school = await prisma.school.upsert({
      where: { slug: "qa-demo" },
      create: { name: "QA Demo School", slug: "qa-demo", ownerId: owner.id, status: "ACTIVE" },
      update: {},
    });

    await prisma.user.update({ where: { id: owner.id }, data: { schoolId: school.id } });

    // ── School Admin ──────────────────────────────────────────────────────
    const adminPassword = "Admin@Qa2026!";
    const admin = await prisma.user.upsert({
      where: { email: "admin@qa.local" },
      create: { name: "Asha Admin", email: "admin@qa.local", password: await hash(adminPassword), role: "SCHOOL_ADMIN", schoolId: school.id },
      update: { schoolId: school.id },
    });

    // ── Founder ───────────────────────────────────────────────────────────
    const founderPassword = "Founder@Qa2026!";
    const founder = await prisma.user.upsert({
      where: { email: "founder@qa.local" },
      create: { name: "Fatima Founder", email: "founder@qa.local", password: await hash(founderPassword), role: "FOUNDER" },
      update: {},
    });

    // ── Class / Section / Subjects ───────────────────────────────────────
    const cls = await prisma.class.upsert({
      where: { name_schoolId: { name: "Grade 5", schoolId: school.id } },
      create: { name: "Grade 5", schoolId: school.id },
      update: {},
    });
    const section = await prisma.section.upsert({
      where: { name_classId: { name: "A", classId: cls.id } },
      create: { name: "A", classId: cls.id },
      update: {},
    });
    const subjectNames = ["Mathematics", "Science", "English"];
    for (const name of subjectNames) {
      await prisma.subject.upsert({
        where: { classId_sectionId_name: { classId: cls.id, sectionId: section.id, name } },
        create: { schoolId: school.id, classId: cls.id, sectionId: section.id, name },
        update: {},
      });
    }

    // ── Teacher ───────────────────────────────────────────────────────────
    const teacherPassword = "Teacher@Qa2026!";
    const teacherUser = await prisma.user.upsert({
      where: { email: "teacher@qa.local" },
      create: { name: "Tara Teacher", email: "teacher@qa.local", password: await hash(teacherPassword), role: "TEACHER", schoolId: school.id },
      update: { schoolId: school.id },
    });
    let teacher = await prisma.teacher.findFirst({ where: { userId: teacherUser.id } });
    if (!teacher) {
      teacher = await prisma.teacher.create({
        data: { name: "Tara Teacher", subject: "Mathematics", schoolId: school.id, userId: teacherUser.id, phone: "9000000001" },
      });
    }

    // ── Students (2 siblings — for the multi-child switcher) ─────────────
    const studentPassword = "Student@Qa2026!";
    const studentPasswordHash = await hash(studentPassword);

    async function upsertStudent(rollNo: string, admissionNo: string, name: string) {
      const existing = await prisma.student.findFirst({ where: { schoolId: school.id, admissionNo } });
      if (existing) return existing;
      return prisma.student.create({
        data: {
          name,
          rollNo,
          admissionNo,
          sectionId: section.id,
          schoolId: school.id,
          passwordHash: studentPasswordHash,
          fatherName: "Rajesh Kumar",
          fatherPhone: "9876500001",
          motherName: "Sunita Kumar",
          motherPhone: "9876500002",
        },
      });
    }
    const child1 = await upsertStudent("101", "QA-2026-0001", "Arjun Kumar");
    const child2 = await upsertStudent("102", "QA-2026-0002", "Ananya Kumar");
    const students = [child1, child2];

    // ── Guardian ──────────────────────────────────────────────────────────
    const guardianPassword = "Guardian@Qa2026!";
    const guardianPhone = "+919876543210";
    let guardian = await prisma.guardian.findFirst({ where: { schoolId: school.id, phone: guardianPhone } });
    if (!guardian) {
      guardian = await prisma.guardian.create({
        data: { name: "Rajesh Kumar", phone: guardianPhone, email: "guardian@qa.local", passwordHash: await hash(guardianPassword), schoolId: school.id },
      });
    }
    for (const [i, student] of students.entries()) {
      const existingLink = await prisma.studentGuardian.findFirst({ where: { studentId: student.id, guardianId: guardian.id } });
      if (!existingLink) {
        await prisma.studentGuardian.create({
          data: { studentId: student.id, guardianId: guardian.id, schoolId: school.id, relationType: "FATHER", isPrimary: i === 0 },
        });
      }
    }

    // ── Attendance (last 14 days, both students) ─────────────────────────
    const today = new Date();
    for (const student of students) {
      for (let d = 0; d < 14; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() - d);
        date.setHours(0, 0, 0, 0);
        if (date.getDay() === 0) continue;
        const status = d % 7 === 0 ? "ABSENT" : d % 5 === 0 ? "LATE" : "PRESENT";
        await prisma.attendance.upsert({
          where: { date_studentId: { date, studentId: student.id } },
          create: { date, type: "STUDENT", status, studentId: student.id, sectionId: section.id, schoolId: school.id, markedById: teacherUser.id },
          update: {},
        });
      }
    }

    // ── Fee structure + partial payment (so "remaining" renders) ─────────
    let feeStructure = await prisma.feeStructure.findFirst({ where: { schoolId: school.id, name: "Annual Tuition Fee" } });
    if (!feeStructure) {
      feeStructure = await prisma.feeStructure.create({ data: { name: "Annual Tuition Fee", amount: 45000, frequency: "ANNUAL", schoolId: school.id } });
    }
    for (const student of students) {
      const alreadyPaid = await prisma.feePayment.findFirst({ where: { studentId: student.id, feeStructureId: feeStructure.id } });
      if (!alreadyPaid) {
        await prisma.feePayment.create({
          data: {
            amount: 20000,
            method: "CASH",
            status: "PAID",
            paidAt: new Date(),
            studentId: student.id,
            feeStructureId: feeStructure.id,
            schoolId: school.id,
            recordedById: owner.id,
          },
        });
      }
    }

    // ── Homework (+ per-student status rows, parent-visible) ──────────────
    let homework = await prisma.homework.findFirst({ where: { schoolId: school.id, title: "Fractions Worksheet" } });
    if (!homework) {
      const now = new Date();
      const dueDate = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
      homework = await prisma.homework.create({
        data: {
          schoolId: school.id,
          sectionId: section.id,
          teacherId: teacher.id,
          subject: "Mathematics",
          title: "Fractions Worksheet",
          description: "Complete pages 12-14.",
          dueDate,
          deadlineAt: dueDate,
          assessmentMode: "CHECKING_ONLY",
          status: "ACTIVE",
        },
      });
    }
    for (const student of students) {
      const existing = await prisma.homeworkStudentStatus.findFirst({ where: { homeworkId: homework.id, studentId: student.id } });
      if (!existing) {
        await prisma.homeworkStudentStatus.create({
          data: { homeworkId: homework.id, studentId: student.id, status: "PENDING", submissionStatus: "PENDING", parentVisible: true },
        });
      }
    }

    // ── Exam scheme / exams / results ─────────────────────────────────────
    let scheme = await prisma.examScheme.findFirst({ where: { schoolId: school.id, name: "Term 1 Examination" } });
    if (!scheme) {
      scheme = await prisma.examScheme.create({ data: { name: "Term 1 Examination", schoolId: school.id } });
    }
    const exams = [];
    for (const [order, subject] of subjectNames.entries()) {
      let exam = await prisma.exam.findFirst({ where: { schemeId: scheme.id, name: subject } });
      if (!exam) {
        exam = await prisma.exam.create({ data: { name: subject, maxMarks: 100, order, schemeId: scheme.id } });
      }
      exams.push(exam);
    }
    for (const student of students) {
      for (const [i, exam] of exams.entries()) {
        const existing = await prisma.examResult.findFirst({ where: { examId: exam.id, studentId: student.id } });
        if (!existing) {
          await prisma.examResult.create({ data: { examId: exam.id, studentId: student.id, marks: 70 + i * 5, submittedById: teacherUser.id } });
        }
      }
    }

    // ── Timetable (a handful of slots) ────────────────────────────────────
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 3; period++) {
        const subject = subjectNames[(day + period) % subjectNames.length];
        await prisma.timetableSlot.upsert({
          where: { sectionId_dayOfWeek_period: { sectionId: section.id, dayOfWeek: day, period } },
          create: { schoolId: school.id, sectionId: section.id, dayOfWeek: day, period, teacherId: teacher.id, subject },
          update: {},
        });
      }
    }

    // ── Report cards (published) ──────────────────────────────────────────
    for (const student of students) {
      const existing = await prisma.reportCard.findFirst({ where: { studentId: student.id, examSchemeId: scheme.id } });
      if (!existing) {
        const rc = await prisma.reportCard.create({
          data: {
            schoolId: school.id,
            studentId: student.id,
            sectionId: section.id,
            examSchemeId: scheme.id,
            generatedByTeacherId: teacher.id,
            status: "PUBLISHED",
            attendanceSummary: "26/28 days present",
            totalMarks: 225,
            percentage: 75,
            grade: "B+",
            publishedAt: new Date(),
          },
        });
        for (const subject of subjectNames) {
          await prisma.reportCardSubject.create({
            data: { reportCardId: rc.id, subject, marks: 75, maxMarks: 100, grade: "B+" },
          });
        }
      }
    }

    // ── Announcement (school-wide, published, audience: guardians+teachers+students)
    let announcement = await prisma.announcement.findFirst({ where: { schoolId: school.id, title: "Welcome to QA Demo School" } });
    if (!announcement) {
      announcement = await prisma.announcement.create({
        data: {
          title: "Welcome to QA Demo School",
          body: "This is a seeded announcement for local QA verification.",
          schoolId: school.id,
          scope: "SCHOOL_WIDE",
          status: "PUBLISHED",
          createdById: owner.id,
          publishedAt: new Date(),
        },
      });
      for (const group of ["GUARDIANS", "TEACHERS", "STUDENTS"] as const) {
        await prisma.announcementAudience.create({ data: { announcementId: announcement.id, group } });
      }
    }

    console.log("[seed-local-qa] done.");
    console.log(`[seed-local-qa] school=${school.slug} (id=${school.id})`);
    console.log(`[seed-local-qa] students: ${child1.admissionNo} / ${child2.admissionNo}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed-local-qa] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
