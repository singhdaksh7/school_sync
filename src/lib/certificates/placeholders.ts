/**
 * Allow-listed template placeholder system (spec §5). CertificateTemplate
 * bodies use ONLY `{{placeholder}}` tokens drawn from this list — never
 * arbitrary HTML/JS. Unknown placeholders are rejected at the Zod boundary
 * (see validateTemplateBody in validation.ts) before a template can be
 * saved, and again defensively at render time (any unresolved/unknown token
 * is left as literal text rather than executed).
 */

export const CERTIFICATE_PLACEHOLDERS = [
  "studentName",
  "admissionNumber",
  "className",
  "sectionName",
  "academicSession",
  "schoolName",
  "issueDate",
  "certificateNumber",
  "purpose",
] as const;

export type CertificatePlaceholder = (typeof CERTIFICATE_PLACEHOLDERS)[number];

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Renders a template string, substituting only allow-listed placeholders
 * present in `values`. Any token not on the allow-list (should never occur —
 * templates are validated at save time — defense in depth only) is left as
 * literal text rather than substituted or evaluated.
 */
export function renderTemplateString(template: string, values: Record<CertificatePlaceholder, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if ((CERTIFICATE_PLACEHOLDERS as readonly string[]).includes(key)) {
      return values[key as CertificatePlaceholder] ?? "";
    }
    return match;
  });
}
