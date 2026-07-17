import { describe, it, expect } from "vitest";
import {
  certificateRequestCreateSchema,
  studentCertificateRequestCreateSchema,
  certificateTemplateCreateSchema,
  validateTemplateBody,
  normalizePurpose,
} from "@/lib/certificates/validation";

describe("certificateRequestCreateSchema", () => {
  it("accepts a valid BONAFIDE request", () => {
    const result = certificateRequestCreateSchema.safeParse({ studentId: "s1", certificateType: "BONAFIDE", purpose: "Scholarship application" });
    expect(result.success).toBe(true);
  });

  it("requires customLabel for CUSTOM", () => {
    const result = certificateRequestCreateSchema.safeParse({ studentId: "s1", certificateType: "CUSTOM", purpose: "Sports award" });
    expect(result.success).toBe(false);
  });

  it("rejects customLabel on a non-CUSTOM type", () => {
    const result = certificateRequestCreateSchema.safeParse({
      studentId: "s1",
      certificateType: "BONAFIDE",
      customLabel: "Not allowed here",
      purpose: "Scholarship application",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown/server-derived fields (schoolId, status, certificateNumber, etc.)", () => {
    const attempt = certificateRequestCreateSchema.safeParse({
      studentId: "s1",
      certificateType: "BONAFIDE",
      purpose: "Scholarship application",
      schoolId: "someone-elses-school",
      status: "ISSUED",
      certificateNumber: "FORGED-0001",
      reviewerId: "u1",
    });
    expect(attempt.success).toBe(false);
  });
});

describe("studentCertificateRequestCreateSchema", () => {
  it("rejects studentId in the body — self-request derives it from the session", () => {
    const result = studentCertificateRequestCreateSchema.safeParse({
      studentId: "someone-elses-id",
      certificateType: "BONAFIDE",
      purpose: "Scholarship application",
    });
    expect(result.success).toBe(false);
  });
});

describe("validateTemplateBody / placeholder allow-list", () => {
  it("accepts documented placeholders", () => {
    const result = validateTemplateBody("This is to certify that {{studentName}} of {{className}}-{{sectionName}} is bonafide.");
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown placeholder", () => {
    const result = validateTemplateBody("Certificate for {{studentName}}, secret code {{internalDbId}}.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("internalDbId");
  });

  it("treats a scripting-style injection attempt as inert literal text, never as an executable placeholder", () => {
    // The placeholder regex only matches {{alphanumeric_only}} — a payload
    // like this doesn't fit that shape, so it is never recognized as a
    // placeholder token at all (found === empty) and is accepted as literal
    // text rather than substituted or executed. This IS the safe behavior:
    // renderTemplateString only ever substitutes allow-listed tokens and
    // never interprets HTML/JS regardless of what a template author types.
    const result = validateTemplateBody("{{<script>alert(1)</script>}}");
    expect(result.ok).toBe(true);
  });
});

describe("certificateTemplateCreateSchema", () => {
  it("rejects a template body containing an unknown placeholder", () => {
    const result = certificateTemplateCreateSchema.safeParse({
      certificateType: "BONAFIDE",
      name: "Standard Bonafide",
      heading: "Bonafide Certificate",
      bodyTemplate: "This is to certify {{studentName}} with secret {{ssn}}.",
      signatoryName: "Dr. Rao",
      signatoryDesignation: "Principal",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a template using only allow-listed placeholders", () => {
    const result = certificateTemplateCreateSchema.safeParse({
      certificateType: "BONAFIDE",
      name: "Standard Bonafide",
      heading: "Bonafide Certificate",
      bodyTemplate: "This is to certify that {{studentName}}, admission no. {{admissionNumber}}, of {{className}}-{{sectionName}}, is bonafide.",
      signatoryName: "Dr. Rao",
      signatoryDesignation: "Principal",
    });
    expect(result.success).toBe(true);
  });
});

describe("normalizePurpose", () => {
  it("lowercases and trims for duplicate-detection comparisons", () => {
    expect(normalizePurpose("  Scholarship Application  ")).toBe("scholarship application");
  });
});
