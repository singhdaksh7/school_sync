import type { CertificateRequest, IssuedCertificate } from "@/generated/prisma/client";

/** Request shape returned to students/guardians (self-service — no internal reviewer identity, no raw storage keys). */
export function serializeRequestForRequester(
  request: CertificateRequest & { issuedCertificate?: { id: string; certificateNumber: string } | null }
) {
  return {
    id: request.id,
    certificateType: request.certificateType,
    customLabel: request.customLabel,
    purpose: request.purpose,
    status: request.status,
    reviewNote: request.status === "REJECTED" ? request.reviewNote : null,
    cancelledAt: request.cancelledAt,
    issuedAt: request.issuedAt,
    issuedCertificateId: request.issuedCertificate?.id ?? null,
    certificateNumber: request.issuedCertificate?.certificateNumber ?? null,
    version: request.version,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

/** Full request shape for staff (queue/detail views) — still never includes raw storage keys. */
export function serializeRequestForStaff(
  request: CertificateRequest & {
    student: { id: string; name: string; admissionNo: string | null; rollNo: string };
    requesterUser?: { id: string; name: string } | null;
    requesterGuardian?: { id: string; name: string } | null;
    reviewer?: { id: string; name: string } | null;
    issuedBy?: { id: string; name: string } | null;
    issuedCertificate?: { id: string; certificateNumber: string } | null;
  }
) {
  return {
    id: request.id,
    student: { id: request.student.id, name: request.student.name, admissionNo: request.student.admissionNo, rollNo: request.student.rollNo },
    certificateType: request.certificateType,
    customLabel: request.customLabel,
    purpose: request.purpose,
    requesterType: request.requesterType,
    requester: request.requesterUser
      ? { type: "STAFF", id: request.requesterUser.id, name: request.requesterUser.name }
      : request.requesterGuardian
        ? { type: "GUARDIAN", id: request.requesterGuardian.id, name: request.requesterGuardian.name }
        : { type: "STUDENT", id: request.studentId, name: request.student.name },
    status: request.status,
    reviewer: request.reviewer ? { id: request.reviewer.id, name: request.reviewer.name } : null,
    reviewedAt: request.reviewedAt,
    reviewNote: request.reviewNote,
    issuedBy: request.issuedBy ? { id: request.issuedBy.id, name: request.issuedBy.name } : null,
    issuedAt: request.issuedAt,
    issuedCertificateId: request.issuedCertificate?.id ?? null,
    certificateNumber: request.issuedCertificate?.certificateNumber ?? null,
    cancelledAt: request.cancelledAt,
    version: request.version,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

/** Issued-certificate register row for staff — never the raw fileId/storageKey, only an authorized download reference. */
export function serializeIssuedCertificate(
  issued: IssuedCertificate & { student: { id: string; name: string; admissionNo: string | null } }
) {
  return {
    id: issued.id,
    student: issued.student,
    certificateType: issued.certificateType,
    certificateNumber: issued.certificateNumber,
    issueDate: issued.issueDate,
    revokedAt: issued.revokedAt,
    revokeReason: issued.revokedAt ? issued.revokeReason : null,
    createdAt: issued.createdAt,
  };
}

/** Minimal public verification payload (spec §8) — no internal IDs, no storage keys, no audit data, no reviewer notes. */
export function serializePublicVerification(issued: {
  certificateNumber: string;
  certificateType: string;
  issueDate: Date;
  revokedAt: Date | null;
  schoolName: string;
  studentName: string;
}) {
  return {
    valid: true as const,
    status: issued.revokedAt ? ("REVOKED" as const) : ("VALID" as const),
    certificateNumber: issued.certificateNumber,
    certificateType: issued.certificateType,
    schoolName: issued.schoolName,
    // Minimal/masked student identification — first name + masked surname
    // initial, per spec §8 ("preferably safely masked/minimal").
    studentName: maskStudentName(issued.studentName),
    issueDate: issued.issueDate,
    revokedAt: issued.revokedAt,
  };
}

function maskStudentName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? fullName;
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${first} ${lastInitial}.`;
}
