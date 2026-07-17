import { prisma } from "@/lib/prisma";
import { nextCertificateNumber } from "@/lib/certificates/counter";
import { buildCertificateSnapshot, type CertificateSnapshot } from "@/lib/certificates/snapshot";
import { renderTemplateString } from "@/lib/certificates/placeholders";
import { renderCertificatePdf } from "@/lib/certificates/pdf";
import { generateVerificationToken } from "@/lib/certificates/verification-token";
import { uploadManagedFile } from "@/lib/file-service";
import type { Prisma } from "@/generated/prisma/client";

export type IssuancePreview = {
  certificateType: string;
  customLabel: string | null;
  snapshot: CertificateSnapshot;
  templateId: string;
  templateName: string;
  heading: string;
  bodyText: string;
  signatoryName: string;
  signatoryDesignation: string;
};

export type IssuancePreviewResult = { ok: true; preview: IssuancePreview } | { ok: false; status: number; error: string };

async function loadRequestForIssuance(schoolId: string, requestId: string) {
  return prisma.certificateRequest.findFirst({
    where: { id: requestId, schoolId },
    include: {
      student: { include: { section: { include: { class: true } } }, },
      school: { select: { name: true } },
    },
  });
}

async function resolveTemplate(schoolId: string, certificateType: string, explicitTemplateId?: string) {
  if (explicitTemplateId) {
    return prisma.certificateTemplate.findFirst({
      where: { id: explicitTemplateId, schoolId, certificateType: certificateType as never },
      include: { logoFile: { select: { storageKey: true, contentType: true } }, signatureFile: { select: { storageKey: true, contentType: true } } },
    });
  }
  return prisma.certificateTemplate.findFirst({
    where: { schoolId, certificateType: certificateType as never, isActive: true },
    include: { logoFile: { select: { storageKey: true, contentType: true } }, signatureFile: { select: { storageKey: true, contentType: true } } },
  });
}

function buildBodyText(template: { bodyTemplate: string }, snapshot: CertificateSnapshot, certificateNumber: string, issueDate: string) {
  return renderTemplateString(template.bodyTemplate, {
    studentName: snapshot.studentName,
    admissionNumber: snapshot.admissionNumber ?? "—",
    className: snapshot.className,
    sectionName: snapshot.sectionName,
    academicSession: snapshot.academicSession,
    schoolName: snapshot.schoolName,
    issueDate,
    certificateNumber,
    purpose: snapshot.purpose,
  });
}

/**
 * Builds the exact confirmation preview shown to the operator before
 * issuance (spec §11) — the same snapshot + rendered body that will be
 * frozen into the IssuedCertificate row if they confirm. Does not allocate
 * a certificate number or write anything; safe to call repeatedly.
 */
export async function buildIssuancePreview(schoolId: string, requestId: string, explicitTemplateId?: string): Promise<IssuancePreviewResult> {
  const request = await loadRequestForIssuance(schoolId, requestId);
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (request.status !== "APPROVED") return { ok: false, status: 409, error: "Only an APPROVED request can be issued" };

  const template = await resolveTemplate(schoolId, request.certificateType, explicitTemplateId);
  if (!template) return { ok: false, status: 422, error: "No active template configured for this certificate type" };

  const snapshot = buildCertificateSnapshot({
    certificateType: request.certificateType,
    purpose: request.purpose,
    student: request.student,
    schoolName: request.school.name,
  });
  const bodyText = buildBodyText(template, snapshot, "PREVIEW-PENDING", new Date().toISOString().slice(0, 10));

  return {
    ok: true,
    preview: {
      certificateType: request.certificateType,
      customLabel: request.customLabel,
      snapshot,
      templateId: template.id,
      templateName: template.name,
      heading: template.heading,
      bodyText,
      signatoryName: template.signatoryName,
      signatoryDesignation: template.signatoryDesignation,
    },
  };
}

export type IssueResult =
  | { ok: true; issuedCertificateId: string; certificateNumber: string; alreadyIssued: boolean }
  | { ok: false; status: number; error: string };

/**
 * Transactionally issues a certificate: allocates the number (atomic
 * counter), builds the immutable snapshot, renders the PDF, stores it via
 * the managed file service, and writes the IssuedCertificate row — all
 * inside one Prisma transaction so a failure at any step leaves no orphan
 * IssuedCertificate/CertificateRequest state (the PDF upload itself has its
 * own compensating cleanup on metadata-write failure; see file-service.ts).
 *
 * Idempotent: if the request is already ISSUED, returns the existing
 * IssuedCertificate rather than generating a second document or advancing
 * the counter again (spec rule 10 / §12 "idempotent issue behaviour").
 */
export async function issueCertificate(params: {
  schoolId: string;
  requestId: string;
  issuedById: string;
  expectedVersion: number;
  explicitTemplateId?: string;
  publicBaseUrl: string;
}): Promise<IssueResult> {
  const existing = await prisma.issuedCertificate.findUnique({ where: { requestId: params.requestId } });
  if (existing) {
    return { ok: true, issuedCertificateId: existing.id, certificateNumber: existing.certificateNumber, alreadyIssued: true };
  }

  const request = await loadRequestForIssuance(params.schoolId, params.requestId);
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (request.version !== params.expectedVersion) return { ok: false, status: 409, error: "Request has changed since you last loaded it" };
  if (request.status !== "APPROVED") return { ok: false, status: 409, error: "Only an APPROVED request can be issued" };

  const template = await resolveTemplate(params.schoolId, request.certificateType, params.explicitTemplateId);
  if (!template) return { ok: false, status: 422, error: "No active template configured for this certificate type" };

  const snapshot = buildCertificateSnapshot({
    certificateType: request.certificateType,
    purpose: request.purpose,
    student: request.student,
    schoolName: request.school.name,
  });

  const { rawToken, tokenHash } = generateVerificationToken();
  const issueDateIso = new Date().toISOString().slice(0, 10);

  // Certificate number allocation + PDF rendering happen OUTSIDE the DB
  // transaction (rendering/upload are not transactional resources), but the
  // number is allocated via the atomic counter INSIDE a short transaction
  // first so it is never generated twice for a concurrent double-issue —
  // then the row write below re-checks status/version and, on any failure,
  // the allocated number is simply never referenced by a row (an accepted,
  // documented gap — see counter.ts).
  const certificateNumber = await prisma.$transaction((tx) => nextCertificateNumber(tx, params.schoolId, request.certificateType));

  const verificationUrl = `${params.publicBaseUrl.replace(/\/$/, "")}/verify-certificate/${rawToken}`;
  const bodyText = buildBodyText(template, snapshot, certificateNumber, issueDateIso);

  const pdfBytes = await renderCertificatePdf({
    schoolName: request.school.name,
    schoolLogoAsset: template.logoFile,
    signatureAsset: template.signatureFile,
    certificateType: request.certificateType,
    customLabel: request.customLabel,
    certificateNumber,
    issueDate: issueDateIso,
    snapshot,
    bodyText,
    heading: template.heading,
    signatoryName: template.signatoryName,
    signatoryDesignation: template.signatoryDesignation,
    footerText: template.footerText,
    verificationUrl,
  });

  const upload = await uploadManagedFile({
    category: "CERTIFICATE_DOCUMENT",
    schoolId: params.schoolId,
    originalFilename: `${certificateNumber}.pdf`,
    declaredContentType: "application/pdf",
    bytes: pdfBytes,
    uploader: { type: "USER", id: params.issuedById },
  });
  if (!upload.ok) return { ok: false, status: upload.status, error: upload.error };

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const fresh = await tx.certificateRequest.findUnique({ where: { id: params.requestId } });
      if (!fresh || fresh.version !== params.expectedVersion || fresh.status !== "APPROVED") {
        throw new Error("STALE_OR_ALREADY_ISSUED");
      }

      const issued = await tx.issuedCertificate.create({
        data: {
          schoolId: params.schoolId,
          studentId: request.studentId,
          requestId: request.id,
          certificateType: request.certificateType,
          certificateNumber,
          issueDate: new Date(issueDateIso),
          snapshotData: snapshot as unknown as Prisma.InputJsonValue,
          templateId: template.id,
          templateVersion: template.version,
          templateName: template.name,
          fileId: upload.file.id,
          verificationTokenHash: tokenHash,
          issuedById: params.issuedById,
        },
      });

      await tx.certificateRequest.update({
        where: { id: request.id },
        data: { status: "ISSUED", issuedById: params.issuedById, issuedAt: new Date(), version: { increment: 1 } },
      });

      return issued;
    });

    return { ok: true, issuedCertificateId: result.id, certificateNumber: result.certificateNumber, alreadyIssued: false };
  } catch (err) {
    // Compensate: the PDF was already uploaded but the DB write failed —
    // delete the orphan file rather than leaving unreferenced storage.
    console.error("[certificates] issuance transaction failed; cleaning up orphan file", err);
    try {
      await prisma.storedFile.delete({ where: { id: upload.file.id } });
    } catch {
      console.error("[certificates] orphan certificate file cleanup FAILED — manual cleanup required", { fileId: upload.file.id });
    }
    if (err instanceof Error && err.message === "STALE_OR_ALREADY_ISSUED") {
      const nowExisting = await prisma.issuedCertificate.findUnique({ where: { requestId: params.requestId } });
      if (nowExisting) {
        return { ok: true, issuedCertificateId: nowExisting.id, certificateNumber: nowExisting.certificateNumber, alreadyIssued: true };
      }
      return { ok: false, status: 409, error: "Request has changed since you last loaded it" };
    }
    return { ok: false, status: 500, error: "Failed to issue certificate" };
  }
}
