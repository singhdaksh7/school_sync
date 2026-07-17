import { prisma } from "@/lib/prisma";
import { hasPrismaErrorCode } from "@/lib/tenant";
import { assertLegalTransition, CertificateTransitionError, isAlreadyInTargetState } from "@/lib/certificates/transitions";
import { normalizePurpose } from "@/lib/certificates/validation";
import { REQUESTER_CANCELLABLE_STATUSES, STAFF_CANCELLABLE_STATUSES, type CertificateTypeValue } from "@/lib/certificates/constants";
import { emitCertificateEvent } from "@/lib/certificates/events";
import type { CertificateRequest } from "@/generated/prisma/client";

export type ActionResult<T = { request: CertificateRequest }> = { ok: true } & T | { ok: false; status: number; error: string };

export type RequesterIdentity =
  | { type: "STUDENT" }
  | { type: "GUARDIAN"; guardianId: string }
  | { type: "STAFF"; userId: string };

/**
 * Creates a new CertificateRequest. Shared by the student/parent/staff
 * create routes — each resolves its own actor + student ownership first,
 * then calls this with the already-authorized studentId and requester
 * identity. Enforces the duplicate-active-request business rule at the app
 * layer (readable error message) in addition to the DB partial unique index
 * (which is the actual source of truth — see the migration).
 */
export async function createCertificateRequest(params: {
  schoolId: string;
  studentId: string;
  certificateType: CertificateTypeValue;
  customLabel: string | null;
  purpose: string;
  requester: RequesterIdentity;
}): Promise<ActionResult> {
  const purposeNormalized = normalizePurpose(params.purpose);

  const duplicate = await prisma.certificateRequest.findFirst({
    where: {
      schoolId: params.schoolId,
      studentId: params.studentId,
      certificateType: params.certificateType,
      purposeNormalized,
      status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED"] },
    },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false, status: 409, error: "An active request for this certificate type and purpose already exists" };
  }

  try {
    const request = await prisma.certificateRequest.create({
      data: {
        schoolId: params.schoolId,
        studentId: params.studentId,
        certificateType: params.certificateType,
        customLabel: params.customLabel,
        purpose: params.purpose,
        purposeNormalized,
        requesterType: params.requester.type,
        requesterGuardianId: params.requester.type === "GUARDIAN" ? params.requester.guardianId : null,
        requesterUserId: params.requester.type === "STAFF" ? params.requester.userId : null,
      },
    });
    emitCertificateEvent({ type: "REQUEST_SUBMITTED", schoolId: params.schoolId, requestId: request.id, studentId: request.studentId });
    return { ok: true, request };
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      return { ok: false, status: 409, error: "An active request for this certificate type and purpose already exists" };
    }
    throw err;
  }
}

async function loadForTransition(schoolId: string, requestId: string) {
  return prisma.certificateRequest.findFirst({ where: { id: requestId, schoolId } });
}

export async function cancelCertificateRequest(params: {
  schoolId: string;
  requestId: string;
  expectedVersion: number;
  actor: { kind: "REQUESTER" | "STAFF"; userId: string };
}): Promise<ActionResult> {
  const request = await loadForTransition(params.schoolId, params.requestId);
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (isAlreadyInTargetState(request.status, "CANCELLED")) return { ok: true, request };

  const allowedFrom = params.actor.kind === "REQUESTER" ? REQUESTER_CANCELLABLE_STATUSES : STAFF_CANCELLABLE_STATUSES;
  if (!allowedFrom.has(request.status)) {
    return { ok: false, status: 409, error: `Request cannot be cancelled from status ${request.status}` };
  }
  if (request.version !== params.expectedVersion) return { ok: false, status: 409, error: "Request has changed since you last loaded it" };

  try {
    assertLegalTransition(request.status, "CANCELLED");
  } catch (err) {
    if (err instanceof CertificateTransitionError) return { ok: false, status: 409, error: err.message };
    throw err;
  }

  const updated = await prisma.certificateRequest.update({
    where: { id: request.id, version: params.expectedVersion },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      // cancelledById is a real FK to User — only set for a STAFF actor.
      // A student/guardian self-cancel has no User row; their identity is
      // already recorded via requesterType/requesterGuardianId/studentId.
      cancelledById: params.actor.kind === "STAFF" ? params.actor.userId : null,
      version: { increment: 1 },
    },
  });
  return { ok: true, request: updated };
}

export async function startCertificateReview(params: { schoolId: string; requestId: string; expectedVersion: number }): Promise<ActionResult> {
  const request = await loadForTransition(params.schoolId, params.requestId);
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (isAlreadyInTargetState(request.status, "UNDER_REVIEW")) return { ok: true, request };
  if (request.version !== params.expectedVersion) return { ok: false, status: 409, error: "Request has changed since you last loaded it" };

  try {
    assertLegalTransition(request.status, "UNDER_REVIEW");
  } catch (err) {
    if (err instanceof CertificateTransitionError) return { ok: false, status: 409, error: err.message };
    throw err;
  }

  const updated = await prisma.certificateRequest.update({
    where: { id: request.id, version: params.expectedVersion },
    data: { status: "UNDER_REVIEW", version: { increment: 1 } },
  });
  return { ok: true, request: updated };
}

export async function approveCertificateRequest(params: {
  schoolId: string;
  requestId: string;
  expectedVersion: number;
  reviewerId: string;
  note: string | null;
}): Promise<ActionResult> {
  const request = await loadForTransition(params.schoolId, params.requestId);
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (isAlreadyInTargetState(request.status, "APPROVED")) return { ok: true, request };
  if (request.version !== params.expectedVersion) return { ok: false, status: 409, error: "Request has changed since you last loaded it" };

  try {
    assertLegalTransition(request.status, "APPROVED");
  } catch (err) {
    if (err instanceof CertificateTransitionError) return { ok: false, status: 409, error: err.message };
    throw err;
  }

  const updated = await prisma.certificateRequest.update({
    where: { id: request.id, version: params.expectedVersion },
    data: { status: "APPROVED", reviewerId: params.reviewerId, reviewedAt: new Date(), reviewNote: params.note, version: { increment: 1 } },
  });
  emitCertificateEvent({ type: "REQUEST_APPROVED", schoolId: params.schoolId, requestId: updated.id, studentId: updated.studentId });
  return { ok: true, request: updated };
}

export async function rejectCertificateRequest(params: {
  schoolId: string;
  requestId: string;
  expectedVersion: number;
  reviewerId: string;
  note: string;
}): Promise<ActionResult> {
  const request = await loadForTransition(params.schoolId, params.requestId);
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (isAlreadyInTargetState(request.status, "REJECTED")) return { ok: true, request };
  if (request.version !== params.expectedVersion) return { ok: false, status: 409, error: "Request has changed since you last loaded it" };

  try {
    assertLegalTransition(request.status, "REJECTED");
  } catch (err) {
    if (err instanceof CertificateTransitionError) return { ok: false, status: 409, error: err.message };
    throw err;
  }

  const updated = await prisma.certificateRequest.update({
    where: { id: request.id, version: params.expectedVersion },
    data: { status: "REJECTED", reviewerId: params.reviewerId, reviewedAt: new Date(), reviewNote: params.note, version: { increment: 1 } },
  });
  emitCertificateEvent({ type: "REQUEST_REJECTED", schoolId: params.schoolId, requestId: updated.id, studentId: updated.studentId });
  return { ok: true, request: updated };
}
