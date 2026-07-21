/**
 * School tenant-data purge — the destructive body of the SCHOOL_DATA_PURGE
 * background job (see src/lib/job-handlers.ts, src/lib/school-deletion.ts).
 *
 * Design:
 *  - Every step is IDEMPOTENT and self-batching (bounded by
 *    SCHOOL_PURGE_BATCH_SIZE per round-trip) — re-running the whole purge
 *    from step 1 after a crash/lease-expiry is always safe: already-deleted
 *    rows simply contribute 0 to that step's next batch.
 *  - Explicit, FK-respecting order: children before parents. High-volume
 *    domain tables are deleted in bounded batches here; low-volume
 *    administrative tables NOT explicitly listed below (AuditLog,
 *    AIInsightCache, CustomDomain, TeacherWorkloadOverride,
 *    SchoolFeatureFlag, FounderNotification, PaymentProofSubmission,
 *    Invoice, TimetableDraft, AuthLoginEvent, AuthFailureState,
 *    SchoolPeriodSchedule, OperationalRoleAssignment, etc.) all have a
 *    verified `onDelete: Cascade` FK to School (see prisma/schema.prisma)
 *    and are removed as a single fast metadata operation when the School row
 *    itself is deleted in the final step — they're a safety net, not the
 *    primary deletion mechanism, and were confirmed cascade-safe by reading
 *    every School relation before writing this file.
 *  - StoredFile is handled specially: the S3 object is proven to belong to
 *    the school via the DB row (never a guessed/user-controlled prefix),
 *    deleted first, then the row. A transient storage error leaves the row
 *    alone for the next run to retry (same contract as file-retention.ts).
 *  - CRITICAL IDENTITY RULE: User rows are NEVER hard-deleted here (avoids
 *    reasoning about hard-delete FK ordering across every one of User's many
 *    relations elsewhere in the app). Instead, every User row that belongs
 *    ONLY to this school is IRREVERSIBLY ANONYMIZED in place: name, email,
 *    and password are overwritten with non-PII placeholders, the unique
 *    email is freed for reuse, and any outstanding password-reset token is
 *    invalidated. Two distinct linkage shapes both hold this school's staff
 *    PII in the shared User table and are both covered:
 *      - School Owner/Admins: User.schoolId points directly at this school.
 *      - Teachers: the login User is linked via Teacher.userId instead
 *        (User.schoolId is not always set for a teacher-role account) — so
 *        that linkage is captured and anonymized BEFORE the Teacher rows
 *        below are deleted, never after (the link would otherwise be lost).
 *    A user who is a Founder, or whose CURRENT User.schoolId/Teacher.userId
 *    points at a DIFFERENT school, is structurally unreachable by either
 *    query and is completely unaffected — see anonymizeUser and its two
 *    callers below.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getStorageProvider, StorageError } from "@/lib/storage";
import { SCHOOL_PURGE_BATCH_SIZE } from "@/lib/cost-guard-policy";

function anonymizedEmailFor(userId: string): string {
  return `deleted-user-${userId}@purged.invalid`;
}

/**
 * Irreversibly anonymizes one school-only User account in place (never a
 * hard delete — see module header). Idempotent: re-running against an
 * already-anonymized row is a same-value no-op, safe on a crash-resumed
 * purge. Also invalidates any outstanding password-reset link, since
 * PasswordResetToken only cascades on User deletion, not on School deletion,
 * and would otherwise remain a live credential-reset path into the
 * now-hollowed-out account.
 */
async function anonymizeUser(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      name: "Deleted User",
      email: anonymizedEmailFor(userId),
      password: crypto.randomBytes(32).toString("hex"), // never a valid hash for any real password; unique per user
      schoolId: null,
    },
  });
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
}

/**
 * Anonymizes every Teacher-linked login User for this school. MUST run
 * before the "teachers" batchDelete below — Teacher.userId is the only link
 * for an account created via the roster/teacher-invite path (its
 * User.schoolId is never set), so deleting the Teacher row first would lose
 * the linkage and leave that account's PII stranded forever.
 */
async function anonymizeTeacherLinkedUsers(schoolId: string, progress: PurgeProgress): Promise<number> {
  let total = 0;
  let skip = 0;
  for (;;) {
    // Not a shrinking-result-set batch (anonymizing a User does not remove
    // the Teacher row from this query) — paginate with skip/take instead.
    // Safe to resume after a crash: this function's own effect
    // (anonymizeUser) is idempotent, so replaying earlier pages is harmless.
    const batch = await prisma.teacher.findMany({
      where: { schoolId, userId: { not: null } },
      select: { userId: true },
      orderBy: { id: "asc" },
      skip,
      take: SCHOOL_PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) break;
    for (const t of batch) {
      if (t.userId) await anonymizeUser(t.userId);
    }
    total += batch.length;
    skip += batch.length;
    await progress.onBatch("teacherUserAccountsAnonymized", batch.length);
    if (batch.length < SCHOOL_PURGE_BATCH_SIZE) break;
  }
  return total;
}

/**
 * Anonymizes every User whose CURRENT schoolId points directly at this
 * school (School Owner + School Admins, and any Teacher-role account
 * created via the direct-invite path that also sets User.schoolId). Each
 * anonymized row's schoolId becomes null, so — like batchDelete — the
 * result set naturally shrinks; no separate cursor bookkeeping needed.
 */
async function anonymizeDirectSchoolUsers(schoolId: string, progress: PurgeProgress): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { schoolId },
      select: { id: true },
      take: SCHOOL_PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) break;
    for (const u of batch) await anonymizeUser(u.id);
    total += batch.length;
    await progress.onBatch("schoolAdminUserAccountsAnonymized", batch.length);
    if (batch.length < SCHOOL_PURGE_BATCH_SIZE) break;
  }
  return total;
}

export type PurgeProgress = { onBatch: (label: string, deletedInStep: number) => Promise<void> };

async function batchDelete(
  label: string,
  findIds: (take: number) => Promise<{ id: string }[]>,
  deleteByIds: (ids: string[]) => Promise<unknown>,
  progress: PurgeProgress
): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await findIds(SCHOOL_PURGE_BATCH_SIZE);
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    await deleteByIds(ids);
    total += ids.length;
    await progress.onBatch(label, ids.length);
    if (rows.length < SCHOOL_PURGE_BATCH_SIZE) break;
  }
  return total;
}

/** Deletes the S3 object for every remaining StoredFile row belonging to this school, then the row — proven ownership via the DB row's schoolId, never a bucket-prefix scan. Idempotent: a missing object is treated as already-cleaned, not a failure. */
async function purgeStoredFiles(schoolId: string, progress: PurgeProgress): Promise<{ deleted: number; skippedNoProvider: boolean }> {
  let provider;
  try {
    provider = getStorageProvider();
  } catch (err) {
    if (err instanceof StorageError && err.code === "NOT_CONFIGURED") {
      // No storage provider configured (e.g. local/dev) — nothing to delete
      // in S3; still remove the metadata rows so the purge can complete.
      const deleted = await batchDelete(
        "storedFiles(metadataOnly)",
        (take) => prisma.storedFile.findMany({ where: { schoolId }, select: { id: true }, take }),
        (ids) => prisma.storedFile.deleteMany({ where: { id: { in: ids } } }),
        progress
      );
      return { deleted, skippedNoProvider: true };
    }
    throw err;
  }

  let deleted = 0;
  for (;;) {
    const batch = await prisma.storedFile.findMany({
      where: { schoolId },
      select: { id: true, storageKey: true },
      take: SCHOOL_PURGE_BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const survivingIds: string[] = [];
    for (const file of batch) {
      try {
        await provider.deleteObject(file.storageKey);
        survivingIds.push(file.id);
      } catch (err) {
        // Transient storage error — leave this row for the next purge
        // attempt to retry; never mark it deleted without proof.
        console.error("[school-purge] StoredFile object delete failed, will retry", { fileId: file.id, err: err instanceof Error ? err.message : err });
      }
    }
    if (survivingIds.length > 0) {
      await prisma.storedFile.deleteMany({ where: { id: { in: survivingIds } } });
      deleted += survivingIds.length;
      await progress.onBatch("storedFiles", survivingIds.length);
    }
    if (batch.length < SCHOOL_PURGE_BATCH_SIZE && survivingIds.length === batch.length) break;
    if (survivingIds.length === 0) break; // whole batch failed to delete from storage — stop, let the next run retry
  }
  return { deleted, skippedNoProvider: false };
}

/**
 * Runs the full ordered purge for one school. Safe to call repeatedly
 * (crash-resume). Returns aggregate (never per-row) counts for the audit
 * tombstone. Does NOT delete the School row itself or write the terminal
 * audit row — the caller (job handler) does that after this resolves, so a
 * partial failure here never leaves an inconsistent "completed" audit.
 */
export async function purgeSchoolData(schoolId: string, progress: PurgeProgress) {
  const counts: Record<string, number> = {};
  const record = async (label: string, n: number) => {
    counts[label] = (counts[label] ?? 0) + n;
  };

  // ── Library circulation (must go before Student/Teacher AND before the
  //    LibraryBookCopy/LibraryBook parents — LibraryLoan/Reservation carry
  //    RESTRICT FKs to copy/book, and Cascade FKs to student/teacher). Order:
  //    history/loans/reservations -> copies -> books -> policy. ────────────────
  record("libraryHistory", await batchDelete(
    "libraryHistory",
    (take) => prisma.libraryHistory.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.libraryHistory.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("libraryLoans", await batchDelete(
    "libraryLoans",
    (take) => prisma.libraryLoan.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.libraryLoan.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("libraryReservations", await batchDelete(
    "libraryReservations",
    (take) => prisma.libraryReservation.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.libraryReservation.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("libraryBookCopies", await batchDelete(
    "libraryBookCopies",
    (take) => prisma.libraryBookCopy.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.libraryBookCopy.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("libraryBooks", await batchDelete(
    "libraryBooks",
    (take) => prisma.libraryBook.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.libraryBook.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("libraryPolicy", await batchDelete(
    "libraryPolicy",
    (take) => prisma.libraryPolicy.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.libraryPolicy.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));

  // ── Children of Student (must go before Student) ──────────────────────────
  record("homeworkSubmissions", await batchDelete(
    "homeworkSubmissions",
    (take) => prisma.homeworkSubmission.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.homeworkSubmission.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("examResults", await batchDelete(
    "examResults",
    (take) => prisma.examResult.findMany({ where: { student: { schoolId } }, select: { id: true }, take }),
    (ids) => prisma.examResult.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("reportCards", await batchDelete(
    "reportCards",
    (take) => prisma.reportCard.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.reportCard.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("feePayments", await batchDelete(
    "feePayments",
    (take) => prisma.feePayment.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.feePayment.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("attendance", await batchDelete(
    "attendance",
    (take) => prisma.attendance.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.attendance.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("studentGuardians", await batchDelete(
    "studentGuardians",
    (take) => prisma.studentGuardian.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.studentGuardian.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));

  // ── School-owned domain/config tables ──────────────────────────────────────
  record("homework", await batchDelete(
    "homework",
    (take) => prisma.homework.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.homework.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("feeStructures", await batchDelete(
    "feeStructures",
    (take) => prisma.feeStructure.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.feeStructure.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("examSchemes", await batchDelete(
    "examSchemes",
    (take) => prisma.examScheme.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.examScheme.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("timetableSlots", await batchDelete(
    "timetableSlots",
    (take) => prisma.timetableSlot.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.timetableSlot.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));

  // ── Storage (S3 objects + metadata) ────────────────────────────────────────
  const storedFilesResult = await purgeStoredFiles(schoolId, progress);
  counts.storedFiles = storedFilesResult.deleted;

  // ── People (Student/Guardian/Teacher rows — never the underlying User) ────
  record("students", await batchDelete(
    "students",
    (take) => prisma.student.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.student.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("guardians", await batchDelete(
    "guardians",
    (take) => prisma.guardian.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.guardian.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  // MUST run before the "teachers" delete below — Teacher.userId is the only
  // link to a roster/teacher-invite login account (its User.schoolId is often
  // never set), so deleting the Teacher row first would strand that
  // account's PII with no linkage left to find it by.
  record("teacherUserAccountsAnonymized", await anonymizeTeacherLinkedUsers(schoolId, progress));
  record("teachers", await batchDelete(
    "teachers",
    (take) => prisma.teacher.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.teacher.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));

  // ── Structure (children before parents: Subject/Section -> Class) ─────────
  record("subjects", await batchDelete(
    "subjects",
    (take) => prisma.subject.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.subject.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("sections", await batchDelete(
    "sections",
    (take) => prisma.section.findMany({ where: { class: { schoolId } }, select: { id: true }, take }),
    (ids) => prisma.section.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("classes", await batchDelete(
    "classes",
    (take) => prisma.class.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.class.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));

  // ── Invitations & background jobs (never the currently-running purge job) ─
  record("schoolInvites", await batchDelete(
    "schoolInvites",
    (take) => prisma.schoolInvite.findMany({ where: { schoolId }, select: { id: true }, take }),
    (ids) => prisma.schoolInvite.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));
  record("backgroundJobs", await batchDelete(
    "backgroundJobs",
    (take) => prisma.backgroundJob.findMany({ where: { schoolId, type: { not: "SCHOOL_DATA_PURGE" } }, select: { id: true }, take }),
    (ids) => prisma.backgroundJob.deleteMany({ where: { id: { in: ids } } }),
    progress
  ));

  // ── Billing assignment ─────────────────────────────────────────────────
  const subscriptionDeleted = await prisma.schoolSubscription.deleteMany({ where: { schoolId } });
  record("subscriptions", subscriptionDeleted.count);

  // ── Identity: irreversibly anonymize every school-only User account ───────
  // Never a bare schoolId: null — see the module header's CRITICAL IDENTITY
  // RULE. Covers School Owner/Admins (User.schoolId points directly at this
  // school); Teacher-linked accounts were already handled above, before the
  // Teacher rows that carried that linkage were deleted.
  record("schoolAdminUserAccountsAnonymized", await anonymizeDirectSchoolUsers(schoolId, progress));

  return counts;
}
