/**
 * Shared student bulk-import logic, used by BOTH the synchronous small-import
 * route and the STUDENT_BULK_IMPORT background job — so duplicate handling,
 * admission/roll rules, guardian phone hashing and the plan cap live in exactly
 * one place.
 *
 * maxStudents is re-evaluated at processing time (the caller passes a freshly
 * read currentCount) and enforced per successful create, so concurrent imports
 * cannot silently exceed the plan cap for the common case. Residual race note:
 * two simultaneous imports each reading the same currentCount could still race
 * to the cap boundary; a fully serializable guarantee would need a row lock /
 * serializable transaction, documented as residual risk.
 */

import { prisma } from "@/lib/prisma";
import { buildStudentPasswordHashes } from "@/lib/student-credentials";
import { backfillHomeworkStatusForStudent } from "@/lib/homework";
import { withinStudentLimit, STUDENT_LIMIT_MESSAGE } from "@/lib/plan-limits";

export type ImportRow = Record<string, unknown>;
export type ImportRowResult = { name: string; success: boolean; error?: string };

export type ImportSummary = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  results: ImportRowResult[];
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function importStudentRows(
  schoolId: string,
  rows: ImportRow[],
  ctx: { maxStudents: number | null; currentCount: number },
  onProgress?: (processed: number, created: number, failed: number) => Promise<void> | void
): Promise<ImportSummary> {
  const classes = await prisma.class.findMany({
    where: { schoolId },
    include: { sections: { select: { id: true, name: true } } },
  });
  const sectionMap: Record<string, string> = {};
  for (const cls of classes) {
    for (const sec of cls.sections) {
      sectionMap[`${cls.name.toLowerCase()}|${sec.name.toLowerCase()}`] = sec.id;
    }
  }

  let createdCount = 0;
  let failedCount = 0;
  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = str(row.name);
    const admissionNo = str(row.admissionno ?? row.admission_no);
    const rollNo = str(row.rollno ?? row.roll_no ?? row.roll);
    const className = str(row.class ?? row.classname).toLowerCase();
    const sectionName = str(row.section).toLowerCase();
    const fatherPhone = str(row.fatherphone ?? row.father_phone);
    const motherPhone = str(row.motherphone ?? row.mother_phone);

    const fail = (error: string) => {
      failedCount += 1;
      results.push({ name: name || "(empty)", success: false, error });
    };

    if (!name || name.length < 2) { fail("Name too short"); }
    else if (!admissionNo) { fail("Admission number missing"); }
    else if (!rollNo) { fail("Roll number missing"); }
    else if (!fatherPhone && !motherPhone) { fail("Father Phone or Mother Phone is required so the student can log in"); }
    else {
      const sectionId = sectionMap[`${className}|${sectionName}`];
      if (!sectionId) {
        fail(`Section not found: Class "${str(row.class)}" Section "${str(row.section)}"`);
      } else if (!withinStudentLimit(ctx.currentCount + createdCount, 1, ctx.maxStudents)) {
        fail(STUDENT_LIMIT_MESSAGE);
      } else {
        try {
          const { fatherPhoneHash, motherPhoneHash } = await buildStudentPasswordHashes(fatherPhone, motherPhone);
          const student = await prisma.student.create({
            data: {
              name,
              admissionNo,
              rollNo,
              email: str(row.email) || null,
              phone: str(row.phone) || null,
              fatherName: str(row.fathername ?? row.father_name) || null,
              fatherPhone: fatherPhone || null,
              fatherPhoneHash,
              motherName: str(row.mothername ?? row.mother_name) || null,
              motherPhone: motherPhone || null,
              motherPhoneHash,
              sectionId,
              schoolId,
            },
          });
          await backfillHomeworkStatusForStudent(student.id, schoolId, sectionId);
          createdCount += 1;
          results.push({ name, success: true });
        } catch {
          failedCount += 1;
          results.push({ name, success: false, error: "Duplicate roll number/admission number or invalid data" });
        }
      }
    }

    if (onProgress && (i % 10 === 9 || i === rows.length - 1)) {
      await onProgress(i + 1, createdCount, failedCount);
    }
  }

  return {
    total: rows.length,
    created: createdCount,
    skipped: results.filter((r) => !r.success && r.error !== "Duplicate roll number/admission number or invalid data").length,
    failed: failedCount,
    results,
  };
}
