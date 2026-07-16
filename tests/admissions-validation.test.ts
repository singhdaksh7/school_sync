import { describe, it, expect } from "vitest";
import {
  admissionApplicationCreateSchema,
  admissionCycleCreateSchema,
  admissionTransitionSchema,
  admissionEnrollSchema,
  admissionOfferingCreateSchema,
  admissionReviewEventUpdateSchema,
  admissionSubmitSchema,
} from "@/lib/admissions/validation";

const validApplicant = {
  admissionCycleId: "cyc1",
  admissionOfferingId: "off1",
  applicantFirstName: "Jane",
  applicantLastName: "Doe",
  applicantDob: "2015-01-01",
  guardianName: "Jane's Mother",
  guardianRelation: "Mother",
  guardianPhone: "9876543210",
};

describe("admissionApplicationCreateSchema — strict boundary", () => {
  it("accepts a valid payload", () => {
    expect(() => admissionApplicationCreateSchema.parse(validApplicant)).not.toThrow();
  });

  it("rejects client-supplied schoolId", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, schoolId: "sch-evil" })).toThrow();
  });

  it("rejects client-supplied createdById", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, createdById: "u-evil" })).toThrow();
  });

  it("rejects client-supplied decidedById", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, decidedById: "u-evil" })).toThrow();
  });

  it("rejects client-supplied enrolledStudentId", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, enrolledStudentId: "stu-evil" })).toThrow();
  });

  it("rejects client-supplied status", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, status: "APPROVED" })).toThrow();
  });

  it("rejects client-supplied applicationNumber", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, applicationNumber: "ADM-9999-000001" })).toThrow();
  });

  it("rejects a future date of birth", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, applicantDob: future.toISOString() })).toThrow();
  });

  it("rejects a DOB more than 100 years ago", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, applicantDob: "1900-01-01" })).toThrow();
  });

  it("accepts a reasonable DOB", () => {
    expect(() => admissionApplicationCreateSchema.parse({ ...validApplicant, applicantDob: "2018-06-15" })).not.toThrow();
  });
});

describe("admissionCycleCreateSchema", () => {
  it("rejects applicationStartAt >= applicationEndAt", () => {
    expect(() =>
      admissionCycleCreateSchema.parse({
        sessionLabel: "2026-27",
        name: "Cycle",
        applicationStartAt: "2026-06-01T00:00:00Z",
        applicationEndAt: "2026-01-01T00:00:00Z",
      })
    ).toThrow();
  });

  it("accepts a valid ordered window", () => {
    expect(() =>
      admissionCycleCreateSchema.parse({
        sessionLabel: "2026-27",
        name: "Cycle",
        applicationStartAt: "2026-01-01T00:00:00Z",
        applicationEndAt: "2026-06-01T00:00:00Z",
      })
    ).not.toThrow();
  });

  it("rejects unknown keys (e.g. client-supplied schoolId / createdById)", () => {
    expect(() =>
      admissionCycleCreateSchema.parse({
        sessionLabel: "2026-27",
        name: "Cycle",
        applicationStartAt: "2026-01-01T00:00:00Z",
        applicationEndAt: "2026-06-01T00:00:00Z",
        schoolId: "sch-evil",
        createdById: "u-evil",
      })
    ).toThrow();
  });
});

describe("admissionOfferingCreateSchema", () => {
  it("rejects negative capacity", () => {
    expect(() => admissionOfferingCreateSchema.parse({ classId: "cls1", capacity: -1 })).toThrow();
  });
  it("accepts zero capacity", () => {
    expect(() => admissionOfferingCreateSchema.parse({ classId: "cls1", capacity: 0 })).not.toThrow();
  });
});

describe("admissionTransitionSchema", () => {
  it("rejects unknown/client-supplied actor fields", () => {
    expect(() => admissionTransitionSchema.parse({ status: "APPROVED", reason: "ok", version: 0, actorId: "u-evil" })).toThrow();
  });
  it("requires a version for optimistic concurrency", () => {
    expect(() => admissionTransitionSchema.parse({ status: "APPROVED", reason: "ok" })).toThrow();
  });
});

describe("admissionSubmitSchema — override requires reason", () => {
  it("rejects override:true without overrideReason", () => {
    expect(() => admissionSubmitSchema.parse({ override: true })).toThrow();
  });
  it("accepts override:true with overrideReason", () => {
    expect(() => admissionSubmitSchema.parse({ override: true, overrideReason: "Late but exceptional case" })).not.toThrow();
  });
  it("accepts no override at all", () => {
    expect(() => admissionSubmitSchema.parse({})).not.toThrow();
  });
});

describe("admissionReviewEventUpdateSchema — score bounds", () => {
  it("rejects score > maxScore", () => {
    expect(() => admissionReviewEventUpdateSchema.parse({ score: 15, maxScore: 10 })).toThrow();
  });
  it("accepts score within [0, maxScore]", () => {
    expect(() => admissionReviewEventUpdateSchema.parse({ score: 8, maxScore: 10 })).not.toThrow();
  });
  it("rejects negative score", () => {
    expect(() => admissionReviewEventUpdateSchema.parse({ score: -1, maxScore: 10 })).toThrow();
  });
});

describe("admissionEnrollSchema", () => {
  it("requires sectionId", () => {
    expect(() => admissionEnrollSchema.parse({})).toThrow();
  });
  it("rejects unknown keys like enrolledStudentId", () => {
    expect(() => admissionEnrollSchema.parse({ sectionId: "sec1", enrolledStudentId: "stu-evil" })).toThrow();
  });
  it("accepts a minimal valid payload", () => {
    expect(() => admissionEnrollSchema.parse({ sectionId: "sec1" })).not.toThrow();
  });
});
