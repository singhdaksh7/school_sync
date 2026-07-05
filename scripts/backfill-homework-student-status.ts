// One-off backfill for the homework-visibility bug: HomeworkStudentStatus rows
// were only ever created as a snapshot at homework-creation time, so any
// student not in the section at that exact moment (added later, transferred
// in, or the section was empty when the homework was assigned) never got a
// row and silently never saw that homework. Going forward this is prevented
// by backfillHomeworkStatusForStudent() in src/lib/homework.ts, called from
// the student create/update/bulk-import/transfer routes. This script fixes
// already-affected existing rows. Safe to re-run — only ever adds missing
// rows, never touches or removes an existing one.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const homeworkList = await prisma.homework.findMany({
      where: { status: { not: "CANCELLED" } },
      select: { id: true, schoolId: true, sectionId: true, title: true },
    });
    console.log(`Checking ${homeworkList.length} non-cancelled homework record(s).`);

    let totalCreated = 0;
    for (const hw of homeworkList) {
      const students = await prisma.student.findMany({
        where: { schoolId: hw.schoolId, sectionId: hw.sectionId },
        select: { id: true },
      });
      if (students.length === 0) continue;

      const existing = await prisma.homeworkStudentStatus.findMany({
        where: { homeworkId: hw.id, studentId: { in: students.map((s) => s.id) } },
        select: { studentId: true },
      });
      const covered = new Set(existing.map((e) => e.studentId));
      const missing = students.filter((s) => !covered.has(s.id));
      if (missing.length === 0) continue;

      const result = await prisma.homeworkStudentStatus.createMany({
        data: missing.map((s) => ({ homeworkId: hw.id, studentId: s.id, status: "PENDING" })),
        skipDuplicates: true,
      });
      console.log(`  "${hw.title}" (${hw.id}): added ${result.count} missing row(s)`);
      totalCreated += result.count;
    }

    console.log(`Backfilled ${totalCreated} HomeworkStudentStatus row(s) in total.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
