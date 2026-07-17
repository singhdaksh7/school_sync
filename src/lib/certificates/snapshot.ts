import type { CertificateTypeValue } from "@/lib/certificates/constants";

/**
 * Immutable issuance snapshot (spec §6). Captures ONLY the validated fields
 * required for the given certificate type at the moment of issuance — never
 * client-supplied, never re-derived from a later (possibly changed) Student
 * profile. Stored as IssuedCertificate.snapshotData (JSONB).
 *
 * The repo has no AcademicSession/AcademicYear model (same documented
 * deviation as src/lib/admissions: AdmissionCycle.sessionLabel is free
 * text) — academicSession here is likewise a derived free-text label
 * ("2026-27"), not a foreign key.
 */

export type CertificateSnapshot = {
  studentName: string;
  admissionNumber: string | null;
  className: string;
  sectionName: string;
  academicSession: string;
  schoolName: string;
  purpose: string;
  // Transfer-certificate-only fields — present only when certificateType is
  // TRANSFER_CERTIFICATE. Deliberately excludes date of birth (spec §6:
  // "only if required and authorized" — not authorized for v1) and never
  // implies board/official migration-certificate status (spec §3).
  dateOfAdmission?: string | null;
  lastClassStudied?: string;
};

/** April–March academic-year label, matching the convention used elsewhere for Indian school sessions. */
export function currentAcademicSessionLabel(asOf: Date = new Date()): string {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth(); // 0-indexed; 3 = April
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function buildCertificateSnapshot(input: {
  certificateType: CertificateTypeValue;
  purpose: string;
  student: {
    name: string;
    admissionNo: string | null;
    createdAt: Date;
    section: { name: string; class: { name: string } };
  };
  schoolName: string;
}): CertificateSnapshot {
  const base: CertificateSnapshot = {
    studentName: input.student.name,
    admissionNumber: input.student.admissionNo,
    className: input.student.section.class.name,
    sectionName: input.student.section.name,
    academicSession: currentAcademicSessionLabel(),
    schoolName: input.schoolName,
    purpose: input.purpose,
  };

  if (input.certificateType === "TRANSFER_CERTIFICATE") {
    return {
      ...base,
      dateOfAdmission: input.student.createdAt.toISOString().slice(0, 10),
      lastClassStudied: `${input.student.section.class.name} ${input.student.section.name}`,
    };
  }

  return base;
}
