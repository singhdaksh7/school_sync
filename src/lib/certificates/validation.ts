import { z } from "zod";
import {
  CERTIFICATE_TYPES,
  CERTIFICATE_REQUEST_STATUSES,
  CERTIFICATE_PURPOSE_MAX_LEN,
  CERTIFICATE_CUSTOM_LABEL_MAX_LEN,
  CERTIFICATE_REVIEW_NOTE_MAX_LEN,
  CERTIFICATE_REVOKE_REASON_MAX_LEN,
} from "@/lib/certificates/constants";
import { CERTIFICATE_PLACEHOLDERS } from "@/lib/certificates/placeholders";

/**
 * Strict Zod boundary schemas for every Certificates API route, following
 * src/lib/admissions/validation.ts's convention: `.strict()` everywhere so
 * unknown keys are rejected outright. Server-derived identity/audit fields
 * (schoolId, studentId ownership, requester/reviewer/issuer ids, status,
 * certificateNumber, verificationToken, file/storage keys, audit metadata,
 * issuedAt/reviewedAt) are NEVER accepted as input on any schema below —
 * they are always computed from the authenticated actor or a server-side
 * atomic counter, never from the request body.
 */

function checkCustomLabel(d: { certificateType: string; customLabel?: string }, ctx: z.RefinementCtx) {
  if (d.certificateType === "CUSTOM" && !d.customLabel) {
    ctx.addIssue({ code: "custom", message: "customLabel is required when certificateType is CUSTOM", path: ["customLabel"] });
  }
  if (d.certificateType !== "CUSTOM" && d.customLabel !== undefined) {
    ctx.addIssue({ code: "custom", message: "customLabel is only valid when certificateType is CUSTOM", path: ["customLabel"] });
  }
}

const certificateRequestBaseFields = {
  certificateType: z.enum(CERTIFICATE_TYPES),
  customLabel: z.string().trim().min(1).max(CERTIFICATE_CUSTOM_LABEL_MAX_LEN).optional(),
  purpose: z.string().trim().min(3).max(CERTIFICATE_PURPOSE_MAX_LEN),
};

// studentId is REQUIRED for a staff-on-behalf-of request and for a guardian
// request (which linked child). The student self-request route uses
// studentCertificateRequestCreateSchema instead, which never accepts
// studentId in the body — it's derived from the authenticated student's own
// session.
export const certificateRequestCreateSchema = z
  .object({ studentId: z.string().min(1), ...certificateRequestBaseFields })
  .strict()
  .superRefine(checkCustomLabel);

/** Student self-request: studentId is implicit (their own session), never accepted from the body. */
export const studentCertificateRequestCreateSchema = z
  .object(certificateRequestBaseFields)
  .strict()
  .superRefine(checkCustomLabel);

export const certificateCancelSchema = z
  .object({
    version: z.number().int().min(0),
  })
  .strict();

export const certificateReviewStartSchema = z
  .object({
    version: z.number().int().min(0),
  })
  .strict();

export const certificateApproveSchema = z
  .object({
    version: z.number().int().min(0),
    note: z.string().trim().max(CERTIFICATE_REVIEW_NOTE_MAX_LEN).optional(),
  })
  .strict();

export const certificateRejectSchema = z
  .object({
    version: z.number().int().min(0),
    note: z.string().trim().min(3).max(CERTIFICATE_REVIEW_NOTE_MAX_LEN),
  })
  .strict();

export const certificateIssueSchema = z
  .object({
    version: z.number().int().min(0),
    templateId: z.string().min(1).optional(),
    // Explicit operator confirmation of the exact snapshot preview shown
    // before issuance (spec §11: "require confirmation"). The server
    // re-derives and re-validates the snapshot itself — this flag only
    // proves the caller saw and confirmed the preview, it never supplies
    // any authoritative field itself.
    confirmed: z.literal(true),
  })
  .strict();

export const certificateRevokeSchema = z
  .object({
    reason: z.string().trim().min(3).max(CERTIFICATE_REVOKE_REASON_MAX_LEN),
  })
  .strict();

export const certificateListQuerySchema = z.object({
  status: z.enum(CERTIFICATE_REQUEST_STATUSES).optional(),
  certificateType: z.enum(CERTIFICATE_TYPES).optional(),
  studentId: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const issuedCertificateListQuerySchema = z.object({
  certificateType: z.enum(CERTIFICATE_TYPES).optional(),
  status: z.enum(["VALID", "REVOKED"]).optional(),
  certificateNumber: z.string().optional(),
  studentName: z.string().optional(),
  admissionNo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Rejects any `{{placeholder}}` not present in the documented allow-list (spec §5). */
export function validateTemplateBody(body: string): { ok: true } | { ok: false; error: string } {
  const found = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
  const unknown = [...found].filter((p) => !CERTIFICATE_PLACEHOLDERS.includes(p as (typeof CERTIFICATE_PLACEHOLDERS)[number]));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown placeholder(s): ${unknown.map((p) => `{{${p}}}`).join(", ")}` };
  }
  return { ok: true };
}

export const certificateTemplateCreateSchema = z
  .object({
    certificateType: z.enum(CERTIFICATE_TYPES),
    name: z.string().trim().min(2).max(120),
    heading: z.string().trim().min(2).max(200),
    bodyTemplate: z.string().trim().min(10).max(8000),
    signatoryName: z.string().trim().min(2).max(120),
    signatoryDesignation: z.string().trim().min(2).max(120),
    footerText: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const result = validateTemplateBody(d.heading + " " + d.bodyTemplate + " " + (d.footerText ?? ""));
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.error, path: ["bodyTemplate"] });
  });

export const certificateTemplateUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    heading: z.string().trim().min(2).max(200).optional(),
    bodyTemplate: z.string().trim().min(10).max(8000).optional(),
    signatoryName: z.string().trim().min(2).max(120).optional(),
    signatoryDesignation: z.string().trim().min(2).max(120).optional(),
    footerText: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const text = [d.heading, d.bodyTemplate, d.footerText].filter((v): v is string => typeof v === "string").join(" ");
    if (!text) return;
    const result = validateTemplateBody(text);
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.error, path: ["bodyTemplate"] });
  });

export function normalizePurpose(purpose: string): string {
  return purpose.trim().toLowerCase();
}
