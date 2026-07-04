/**
 * Server-side upload validation. Never trust the browser's declared MIME type,
 * the file extension, or the client-declared size — validate the actual bytes.
 *
 * Each use-case has a conservative, explicit policy. SVG is rejected everywhere
 * (it can carry active script); HTML is never an accepted upload type.
 */

import type { StorageVisibility } from "@/lib/storage";

export type UploadCategory =
  | "BRANDING_IMAGE"
  | "HOMEWORK_ATTACHMENT"
  | "HOMEWORK_SUBMISSION"
  | "PAYMENT_PROOF"
  | "REPORT_CARD_ASSET";

export type UploadPolicy = {
  allowedContentTypes: readonly string[];
  maxBytes: number;
  visibility: StorageVisibility;
};

const MB = 1024 * 1024;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const UPLOAD_POLICIES: Record<UploadCategory, UploadPolicy> = {
  BRANDING_IMAGE: { allowedContentTypes: IMAGE_TYPES, maxBytes: 2 * MB, visibility: "PUBLIC" },
  HOMEWORK_ATTACHMENT: {
    allowedContentTypes: [...IMAGE_TYPES, "application/pdf"],
    maxBytes: 15 * MB,
    visibility: "TENANT_PRIVATE",
  },
  HOMEWORK_SUBMISSION: {
    allowedContentTypes: [...IMAGE_TYPES, "application/pdf"],
    maxBytes: 15 * MB,
    visibility: "SCOPED_PRIVATE",
  },
  PAYMENT_PROOF: {
    allowedContentTypes: [...IMAGE_TYPES, "application/pdf"],
    maxBytes: 10 * MB,
    visibility: "BILLING_PRIVATE",
  },
  REPORT_CARD_ASSET: { allowedContentTypes: IMAGE_TYPES, maxBytes: 3 * MB, visibility: "TENANT_PRIVATE" },
};

/** Content types this app will NEVER accept as an upload, regardless of category. */
export const FORBIDDEN_CONTENT_TYPES = [
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
] as const;

/**
 * Sniffs the real content type from the leading magic bytes. Returns null when
 * the bytes don't match a supported binary type (so we reject rather than guess).
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  // Leading '<' → markup (SVG/HTML/XML); always treated as forbidden.
  const start = new TextDecoder().decode(b.slice(0, 64)).trimStart().toLowerCase();
  if (start.startsWith("<")) return "text/markup";
  return null;
}

export type UploadValidationResult =
  | { ok: true; contentType: string; size: number; visibility: StorageVisibility }
  | { ok: false; error: string };

/**
 * Validates a candidate upload against its category policy. When `bytes` are
 * provided, the SNIFFED type is authoritative and must both be allowed and agree
 * with the declared type; markup (SVG/HTML/XML) is always rejected.
 */
export function validateUpload(
  category: UploadCategory,
  input: { declaredContentType?: string; size: number; bytes?: Uint8Array }
): UploadValidationResult {
  const policy = UPLOAD_POLICIES[category];

  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, error: "Empty or invalid file" };
  }
  if (input.size > policy.maxBytes) {
    return { ok: false, error: `File exceeds the ${Math.round(policy.maxBytes / MB)}MB limit` };
  }

  const declared = (input.declaredContentType ?? "").toLowerCase().split(";")[0].trim();
  if (declared && (FORBIDDEN_CONTENT_TYPES as readonly string[]).includes(declared)) {
    return { ok: false, error: "This file type is not allowed" };
  }

  let effective = declared;

  if (input.bytes) {
    if (input.bytes.byteLength !== input.size) {
      return { ok: false, error: "Declared size does not match file contents" };
    }
    const sniffed = sniffContentType(input.bytes);
    if (!sniffed || sniffed === "text/markup") {
      return { ok: false, error: "Unsupported or unsafe file content" };
    }
    // Sniffed bytes are authoritative; a mismatching declared type is rejected.
    if (declared && declared !== sniffed) {
      return { ok: false, error: "File content does not match its declared type" };
    }
    effective = sniffed;
  }

  if (!effective) {
    return { ok: false, error: "Missing content type" };
  }
  if (!policy.allowedContentTypes.includes(effective)) {
    return { ok: false, error: "This file type is not allowed for this upload" };
  }

  return { ok: true, contentType: effective, size: input.size, visibility: policy.visibility };
}
