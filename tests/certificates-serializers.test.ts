import { describe, it, expect } from "vitest";
import { serializePublicVerification } from "@/lib/certificates/serializers";

describe("serializePublicVerification", () => {
  it("returns VALID status and a masked student name for a non-revoked certificate", () => {
    const result = serializePublicVerification({
      certificateNumber: "BON-2026-000123",
      certificateType: "BONAFIDE",
      issueDate: new Date("2026-07-01"),
      revokedAt: null,
      schoolName: "Sample Public School",
      studentName: "Aarav Sharma",
    });
    expect(result.status).toBe("VALID");
    expect(result.studentName).toBe("Aarav S.");
    expect(result.revokedAt).toBeNull();
  });

  it("returns REVOKED status with revocation date but never the private reason", () => {
    const result = serializePublicVerification({
      certificateNumber: "BON-2026-000123",
      certificateType: "BONAFIDE",
      issueDate: new Date("2026-07-01"),
      revokedAt: new Date("2026-08-01"),
      schoolName: "Sample Public School",
      studentName: "Aarav Sharma",
    });
    expect(result.status).toBe("REVOKED");
    expect(result.revokedAt).not.toBeNull();
    expect(result).not.toHaveProperty("revokeReason");
  });

  it("never includes internal IDs, storage keys, or audit metadata", () => {
    const result = serializePublicVerification({
      certificateNumber: "BON-2026-000123",
      certificateType: "BONAFIDE",
      issueDate: new Date("2026-07-01"),
      revokedAt: null,
      schoolName: "Sample Public School",
      studentName: "Aarav Sharma",
    });
    const keys = Object.keys(result);
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("fileId");
    expect(keys).not.toContain("storageKey");
    expect(keys).not.toContain("reviewNote");
  });
});
