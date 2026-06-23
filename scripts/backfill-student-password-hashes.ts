// One-off backfill referenced by prisma/migrations/20260622120100_student_father_mother_fields:
// that migration copies legacy parentPhone -> fatherPhone via raw SQL but can't bcrypt-hash it.
// Fills only NULL hash columns, so it's safe to re-run and never overwrites an existing hash.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { buildStudentPasswordHashes } from "../src/lib/student-credentials";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const students = await prisma.student.findMany({
      where: {
        OR: [
          { fatherPhone: { not: null }, fatherPhoneHash: null },
          { motherPhone: { not: null }, motherPhoneHash: null },
        ],
      },
      select: { id: true, fatherPhone: true, fatherPhoneHash: true, motherPhone: true, motherPhoneHash: true },
    });

    console.log(`Found ${students.length} student(s) needing a hash backfill.`);

    let updated = 0;
    for (const student of students) {
      const { fatherPhoneHash, motherPhoneHash } = await buildStudentPasswordHashes(
        student.fatherPhone,
        student.motherPhone
      );
      await prisma.student.update({
        where: { id: student.id },
        data: {
          fatherPhoneHash: student.fatherPhoneHash ?? fatherPhoneHash,
          motherPhoneHash: student.motherPhoneHash ?? motherPhoneHash,
        },
      });
      updated++;
    }

    console.log(`Backfilled password hashes for ${updated} student(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
