import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { buildStudentPasswordHashes } from "@/lib/student-credentials";

export type StudentCreateInput = {
  name: string;
  admissionNo: string;
  rollNo: string;
  sectionId: string;
  schoolId: string;
  email?: string | null;
  phone?: string | null;
  fatherName?: string | null;
  fatherPhone?: string | null;
  motherName?: string | null;
  motherPhone?: string | null;
};

/**
 * Single source of truth for creating a Student row (password-hash
 * derivation + the row shape). Extracted from the admin students POST route
 * (src/app/api/schools/[schoolId]/students/route.ts) in a minimal refactor
 * so the Admissions enrollment-conversion transaction (src/lib/admissions/
 * enrollment.ts) can create a student through the SAME rules inside its own
 * `$transaction` — rather than duplicating student-creation logic — by
 * accepting any Prisma client/transaction-client that exposes `student.create`.
 * Callers keep doing their own validation (section-belongs-to-school, plan
 * student-limit checks, etc.) before calling this — this function only
 * encapsulates the row-creation rules that must stay identical everywhere a
 * Student is created.
 */
export async function createStudentRecord(
  client: PrismaClient | Prisma.TransactionClient,
  data: StudentCreateInput,
  opts: { include?: Prisma.StudentInclude } = {}
) {
  const { fatherPhoneHash, motherPhoneHash } = await buildStudentPasswordHashes(data.fatherPhone, data.motherPhone);
  return client.student.create({
    data: {
      name: data.name,
      admissionNo: data.admissionNo,
      rollNo: data.rollNo,
      email: data.email || null,
      phone: data.phone || null,
      fatherName: data.fatherName || null,
      fatherPhone: data.fatherPhone || null,
      fatherPhoneHash,
      motherName: data.motherName || null,
      motherPhone: data.motherPhone || null,
      motherPhoneHash,
      sectionId: data.sectionId,
      schoolId: data.schoolId,
    },
    include: opts.include,
  });
}
