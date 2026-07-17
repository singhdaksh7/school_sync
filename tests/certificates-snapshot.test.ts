import { describe, it, expect } from "vitest";
import { buildCertificateSnapshot, currentAcademicSessionLabel } from "@/lib/certificates/snapshot";

const student = {
  name: "Aarav Sharma",
  admissionNo: "ADM-0042",
  createdAt: new Date("2022-06-01T00:00:00Z"),
  section: { name: "A", class: { name: "Grade 8" } },
};

describe("buildCertificateSnapshot", () => {
  it("captures only the validated fields for a BONAFIDE certificate", () => {
    const snapshot = buildCertificateSnapshot({ certificateType: "BONAFIDE", purpose: "Scholarship", student, schoolName: "Sample School" });
    expect(snapshot.studentName).toBe("Aarav Sharma");
    expect(snapshot.admissionNumber).toBe("ADM-0042");
    expect(snapshot.className).toBe("Grade 8");
    expect(snapshot.sectionName).toBe("A");
    expect(snapshot.schoolName).toBe("Sample School");
    expect(snapshot.purpose).toBe("Scholarship");
    expect(snapshot.dateOfAdmission).toBeUndefined();
    expect(snapshot.lastClassStudied).toBeUndefined();
  });

  it("adds transfer-certificate-only fields for TRANSFER_CERTIFICATE, and excludes DOB", () => {
    const snapshot = buildCertificateSnapshot({ certificateType: "TRANSFER_CERTIFICATE", purpose: "Relocation", student, schoolName: "Sample School" });
    expect(snapshot.dateOfAdmission).toBe("2022-06-01");
    expect(snapshot.lastClassStudied).toBe("Grade 8 A");
    expect(snapshot).not.toHaveProperty("dateOfBirth");
  });

  it("is a pure function of its inputs — a later profile change does not retroactively alter a snapshot already built", () => {
    const before = buildCertificateSnapshot({ certificateType: "BONAFIDE", purpose: "Scholarship", student, schoolName: "Sample School" });
    const changedStudent = { ...student, name: "Aarav Sharma (renamed)" };
    const after = buildCertificateSnapshot({ certificateType: "BONAFIDE", purpose: "Scholarship", student: changedStudent, schoolName: "Sample School" });
    expect(before.studentName).toBe("Aarav Sharma");
    expect(after.studentName).toBe("Aarav Sharma (renamed)");
    expect(before.studentName).not.toBe(after.studentName);
  });
});

describe("currentAcademicSessionLabel", () => {
  it("uses the April-start year for dates in H2", () => {
    expect(currentAcademicSessionLabel(new Date("2026-11-01T00:00:00Z"))).toBe("2026-27");
  });
  it("uses the prior calendar year's start for dates before April", () => {
    expect(currentAcademicSessionLabel(new Date("2026-02-01T00:00:00Z"))).toBe("2025-26");
  });
});
