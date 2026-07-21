import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizePhone } from "@/lib/parent-auth";
import { createStudentRecord } from "@/lib/student-creation";
import { backfillHomeworkStatusForStudent } from "@/lib/homework";

export type EnrollmentFailureCode =
  | "NOT_APPROVED"
  | "ALREADY_CONVERTED"
  | "SECTION_INVALID"
  | "ROLL_NUMBER_TAKEN";

export class EnrollmentError extends Error {
  constructor(public readonly code: EnrollmentFailureCode, message: string) {
    super(message);
    this.name = "EnrollmentError";
  }
}

export type DuplicateCandidate = { studentId: string; name: string; admissionNo: string | null; sectionId: string };

/**
 * Deterministic possible-duplicate check: same school + case-insensitive full
 * name match + a linked guardian sharing the applicant's (normalized)
 * guardian phone. The Student model has no DOB field to compare against
 * (documented gap — see PR description), so name+guardian-phone is the best
 * deterministic signal actually available in this schema today.
 *
 * MUST be called with the same transaction client as the rest of the
 * enrollment conversion (see enrollApplication below) — running this check
 * against the non-transactional `prisma` handle would let two concurrent
 * conversions both observe "no duplicate" before either commits, defeating
 * the row lock's whole purpose.
 */
export async function findDuplicateCandidates(
  client: PrismaClient | Prisma.TransactionClient,
  schoolId: string,
  applicantFullName: string,
  guardianPhone: string
): Promise<DuplicateCandidate[]> {
  const normalizedPhone = normalizePhone(guardianPhone);
  const candidates = await client.student.findMany({
    where: {
      schoolId,
      name: { equals: applicantFullName, mode: "insensitive" },
      guardianLinks: { some: { guardian: { phone: normalizedPhone } } },
    },
    select: { id: true, name: true, admissionNo: true, sectionId: true },
  });
  return candidates.map((c) => ({ studentId: c.id, name: c.name, admissionNo: c.admissionNo, sectionId: c.sectionId }));
}

export type EnrollmentResult = {
  student: { id: string; name: string; rollNo: string; admissionNo: string | null; sectionId: string };
};

/**
 * The enrollment-conversion transaction — the highest-risk action in this
 * module. One `$transaction` performs, in order:
 *   1. Row-lock the application (`SELECT ... FOR UPDATE`) to serialize
 *      concurrent conversion attempts on the same row.
 *   2. Re-verify APPROVED + not already converted via a WHERE-guarded
 *      UPDATE (`status = 'APPROVED' AND enrolledStudentId IS NULL`) — the
 *      authoritative concurrency guard: under Postgres MVCC + row locking, a
 *      second concurrent transaction's UPDATE blocks on the first, then
 *      re-evaluates the WHERE clause once unblocked and affects 0 rows.
 *   3. Re-validate the offering/cycle/class are still consistent.
 *   4. Duplicate-candidate check (name + guardian phone) — returns
 *      candidates WITHOUT creating anything unless the caller passed
 *      confirmedDuplicate.
 *   5. Creates the Student via the shared createStudentRecord() helper (same
 *      rules as the admin Students API), inside this same transaction.
 *   6. Upserts/links the Guardian via the same schoolId+phone convention used
 *      by the existing Guardians API.
 *   7. Sets enrolledStudentId + transitions to ENROLLED.
 *   8. Writes an AdmissionStatusHistory row.
 *   9. Writes the repo's AuditLog via logAudit — called by the ROUTE after
 *      the transaction commits (logAudit is fire-and-forget/best-effort by
 *      design elsewhere in this repo and must not be allowed to roll back a
 *      successful enrollment).
 * Any failure anywhere in 1-8 rolls back the whole transaction — zero
 * partial student/guardian/enrolledStudentId/status rows.
 *
 * Login credentials: creating the Student row inherently sets
 * fatherPhoneHash/motherPhoneHash IF fatherPhone/motherPhone are provided
 * (see src/lib/student-credentials.ts) — but the admission application only
 * ever collects a single primary guardian phone, which is intentionally NOT
 * mapped to fatherPhone/motherPhone here, so no student login password is
 * created as a side effect of enrollment. No invitations are sent.
 */
export async function enrollApplication(
  schoolId: string,
  applicationId: string,
  actorId: string,
  input: { sectionId: string; rollNo?: string; confirmedDuplicate?: boolean }
): Promise<
  | { ok: true; result: EnrollmentResult }
  | { ok: false; reason: "DUPLICATE_CANDIDATE"; candidates: DuplicateCandidate[] }
  | { ok: false; reason: "ERROR"; error: EnrollmentError }
> {
  type TxOutcome =
    | { duplicate: DuplicateCandidate[]; student?: undefined }
    | { duplicate?: undefined; student: EnrollmentResult["student"] };

  try {
    const result: TxOutcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      // 1. Row lock.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "AdmissionApplication" WHERE id = ${applicationId} AND "schoolId" = ${schoolId} FOR UPDATE
      `;
      if (locked.length === 0) throw new EnrollmentError("NOT_APPROVED", "Application not found");

      const application = await tx.admissionApplication.findFirstOrThrow({
        where: { id: applicationId, schoolId },
        include: { admissionOffering: { include: { class: true } }, admissionCycle: true },
      });

      if (application.status !== "APPROVED") throw new EnrollmentError("NOT_APPROVED", "Application must be APPROVED to enroll");
      if (application.enrolledStudentId) throw new EnrollmentError("ALREADY_CONVERTED", "Application has already been converted");

      const section = await tx.section.findFirst({ where: { id: input.sectionId, classId: application.admissionOffering.classId } });
      if (!section) throw new EnrollmentError("SECTION_INVALID", "Section does not belong to the offering's class");

      const applicantFullName = [application.applicantFirstName, application.applicantMiddleName, application.applicantLastName]
        .filter(Boolean)
        .join(" ");

      if (!input.confirmedDuplicate) {
        const candidates = await findDuplicateCandidates(tx, schoolId, applicantFullName, application.guardianPhone);
        if (candidates.length > 0) {
          return { duplicate: candidates } as const;
        }
      }

      const rollNo = input.rollNo?.trim() || application.applicationNumber;

      const student = await createStudentRecord(tx, {
        name: applicantFullName,
        admissionNo: application.applicationNumber,
        rollNo,
        sectionId: input.sectionId,
        schoolId,
      });

      const normalizedPhone = normalizePhone(application.guardianPhone);
      const guardian = await tx.guardian.upsert({
        where: { schoolId_phone: { schoolId, phone: normalizedPhone } },
        create: { schoolId, name: application.guardianName, phone: normalizedPhone, email: application.guardianEmail },
        update: { name: application.guardianName, email: application.guardianEmail ?? undefined },
      });
      await tx.studentGuardian.upsert({
        where: { studentId_guardianId: { studentId: student.id, guardianId: guardian.id } },
        create: { schoolId, studentId: student.id, guardianId: guardian.id, relationType: application.guardianRelation, isPrimary: true },
        update: { relationType: application.guardianRelation, isPrimary: true },
      });

      // 2/7. WHERE-guarded update — the authoritative concurrency guard.
      const updated = await tx.admissionApplication.updateMany({
        where: { id: applicationId, schoolId, status: "APPROVED", enrolledStudentId: null },
        data: { enrolledStudentId: student.id, status: "ENROLLED", version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new EnrollmentError("ALREADY_CONVERTED", "Application was converted concurrently");

      await tx.admissionStatusHistory.create({
        data: {
          applicationId,
          schoolId,
          previousStatus: "APPROVED",
          newStatus: "ENROLLED",
          reason: `Enrolled as student ${student.id}`,
          actorId,
        },
      });

      return {
        student: { id: student.id, name: student.name, rollNo: student.rollNo, admissionNo: student.admissionNo, sectionId: student.sectionId },
      } as const;
    });

    if (result.duplicate) {
      return { ok: false, reason: "DUPLICATE_CANDIDATE", candidates: result.duplicate };
    }
    if (!result.student) throw new Error("Unreachable: enrollment transaction returned neither student nor duplicate");

    // Best-effort, non-transactional backfill (matches the admin Students API's
    // own behavior) — never allowed to roll back a successful enrollment.
    backfillHomeworkStatusForStudent(result.student.id, schoolId, result.student.sectionId).catch(() => {});

    return { ok: true, result: { student: result.student } };
  } catch (err) {
    if (err instanceof EnrollmentError) return { ok: false, reason: "ERROR", error: err };
    if ((err as { code?: unknown })?.code === "P2002") {
      return { ok: false, reason: "ERROR", error: new EnrollmentError("ROLL_NUMBER_TAKEN", "Roll number or admission number already exists") };
    }
    throw err;
  }
}
