import { describe, expect, it } from "vitest";
import {
  createHomeworkSchema,
  editHomeworkSchema,
  getEffectiveHomeworkStatus,
  isHomeworkVisibleToStudents,
  omitPrivateRemark,
  shouldShowMaxMarks,
  validateAssessmentMode,
  validateHomeworkDates,
  validateStatusTransition,
  validateStudentMarks,
} from "@/lib/homework";

describe("Homework 2.0 — validateHomeworkDates", () => {
  it("rejects a start date strictly after the submission deadline", () => {
    expect(
      validateHomeworkDates({ dueDate: new Date("2026-01-02T00:00:00Z"), deadlineAt: new Date("2026-01-01T00:00:00Z") })
    ).toMatch(/before the submission deadline/);
  });

  it("accepts a start date equal to the deadline — a degenerate-but-legal case, matching every pre-2.0 row (also still reachable via the edit path)", () => {
    const same = new Date("2026-01-01T10:00:00Z");
    expect(validateHomeworkDates({ dueDate: same, deadlineAt: same })).toBeNull();
  });

  it("accepts a start date strictly before the deadline", () => {
    expect(
      validateHomeworkDates({ dueDate: new Date("2026-01-01T00:00:00Z"), deadlineAt: new Date("2026-01-02T00:00:00Z") })
    ).toBeNull();
  });

  it("rejects a checking deadline before the submission deadline", () => {
    const error = validateHomeworkDates({
      dueDate: new Date("2026-01-01T00:00:00Z"),
      deadlineAt: new Date("2026-01-05T00:00:00Z"),
      checkingDeadlineAt: new Date("2026-01-03T00:00:00Z"),
    });
    expect(error).toMatch(/Checking deadline cannot be before/);
  });

  it("accepts a checking deadline exactly at or after the submission deadline", () => {
    const deadlineAt = new Date("2026-01-05T00:00:00Z");
    expect(
      validateHomeworkDates({ dueDate: new Date("2026-01-01T00:00:00Z"), deadlineAt, checkingDeadlineAt: deadlineAt })
    ).toBeNull();
    expect(
      validateHomeworkDates({
        dueDate: new Date("2026-01-01T00:00:00Z"),
        deadlineAt,
        checkingDeadlineAt: new Date("2026-01-10T00:00:00Z"),
      })
    ).toBeNull();
  });

  it("a null checkingDeadlineAt is always valid (it's optional)", () => {
    expect(
      validateHomeworkDates({ dueDate: new Date("2026-01-01T00:00:00Z"), deadlineAt: new Date("2026-01-02T00:00:00Z"), checkingDeadlineAt: null })
    ).toBeNull();
  });
});

describe("Homework 2.0 — validateAssessmentMode", () => {
  it("CHECKING_ONLY must not have maxMarks", () => {
    expect(validateAssessmentMode({ assessmentMode: "CHECKING_ONLY", maxMarks: null })).toBeNull();
    expect(validateAssessmentMode({ assessmentMode: "CHECKING_ONLY", maxMarks: 10 })).toMatch(/must not have maximum marks/);
  });

  it("GRADED requires maxMarks > 0", () => {
    expect(validateAssessmentMode({ assessmentMode: "GRADED", maxMarks: null })).toMatch(/is required/);
    expect(validateAssessmentMode({ assessmentMode: "GRADED", maxMarks: 0 })).toMatch(/greater than zero/);
    expect(validateAssessmentMode({ assessmentMode: "GRADED", maxMarks: -5 })).toMatch(/greater than zero/);
    expect(validateAssessmentMode({ assessmentMode: "GRADED", maxMarks: 10 })).toBeNull();
  });

  it("GRADED supports decimal maxMarks (project convention: Float, matches existing score/maxScore columns)", () => {
    expect(validateAssessmentMode({ assessmentMode: "GRADED", maxMarks: 12.5 })).toBeNull();
  });
});

describe("Homework 2.0 — validateStudentMarks (the CHECKING_ONLY/GRADED hard boundary)", () => {
  it("CHECKING_ONLY never accepts a score, regardless of caller input", () => {
    expect(validateStudentMarks({ assessmentMode: "CHECKING_ONLY", homeworkMaxMarks: null, score: null })).toBeNull();
    expect(validateStudentMarks({ assessmentMode: "CHECKING_ONLY", homeworkMaxMarks: null, score: 0 })).toMatch(
      /cannot be recorded for checking-only/
    );
    expect(validateStudentMarks({ assessmentMode: "CHECKING_ONLY", homeworkMaxMarks: null, score: 5 })).toMatch(
      /cannot be recorded for checking-only/
    );
  });

  it("GRADED: a null score is always legal — 'not checked yet' is distinct from a checked zero", () => {
    expect(validateStudentMarks({ assessmentMode: "GRADED", homeworkMaxMarks: 10, score: null })).toBeNull();
  });

  it("GRADED: a checked zero score is legal and distinct from not-checked", () => {
    expect(validateStudentMarks({ assessmentMode: "GRADED", homeworkMaxMarks: 10, score: 0 })).toBeNull();
  });

  it("GRADED: rejects a negative score", () => {
    expect(validateStudentMarks({ assessmentMode: "GRADED", homeworkMaxMarks: 10, score: -1 })).toMatch(/cannot be negative/);
  });

  it("GRADED: rejects a score above the homework's maxMarks", () => {
    expect(validateStudentMarks({ assessmentMode: "GRADED", homeworkMaxMarks: 10, score: 11 })).toMatch(/cannot exceed the maximum marks/);
    expect(validateStudentMarks({ assessmentMode: "GRADED", homeworkMaxMarks: 10, score: 10 })).toBeNull();
  });

  it("GRADED: a legacy homework with maxMarks still null (pre-2.0 backfill) doesn't reject an in-range score", () => {
    expect(validateStudentMarks({ assessmentMode: "GRADED", homeworkMaxMarks: null, score: 42 })).toBeNull();
  });
});

describe("Homework 2.0 — scheduled visibility derivation (no client-side timer, no durable job)", () => {
  it("SCHEDULED with a future start date stays SCHEDULED", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const homework = { status: "SCHEDULED" as const, dueDate: new Date("2026-01-05T00:00:00Z") };
    expect(getEffectiveHomeworkStatus(homework, now)).toBe("SCHEDULED");
    expect(isHomeworkVisibleToStudents(homework, now)).toBe(false);
  });

  it("SCHEDULED becomes effectively ACTIVE once the start date/time has passed", () => {
    const now = new Date("2026-01-05T00:00:01Z");
    const homework = { status: "SCHEDULED" as const, dueDate: new Date("2026-01-05T00:00:00Z") };
    expect(getEffectiveHomeworkStatus(homework, now)).toBe("ACTIVE");
    expect(isHomeworkVisibleToStudents(homework, now)).toBe(true);
  });

  it("SCHEDULED becomes ACTIVE at the exact instant of the start date (>=)", () => {
    const start = new Date("2026-01-05T09:30:00Z");
    expect(getEffectiveHomeworkStatus({ status: "SCHEDULED", dueDate: start }, start)).toBe("ACTIVE");
  });

  it("DRAFT is never visible, regardless of dueDate", () => {
    const homework = { status: "DRAFT" as const, dueDate: new Date("2020-01-01T00:00:00Z") };
    expect(isHomeworkVisibleToStudents(homework)).toBe(false);
  });

  it("CLOSED remains visible (students can still see a closed assignment's outcome)", () => {
    const homework = { status: "CLOSED" as const, dueDate: new Date("2020-01-01T00:00:00Z") };
    expect(isHomeworkVisibleToStudents(homework)).toBe(true);
  });

  it("CANCELLED is not visible", () => {
    const homework = { status: "CANCELLED" as const, dueDate: new Date("2020-01-01T00:00:00Z") };
    expect(isHomeworkVisibleToStudents(homework)).toBe(false);
  });

  it("ACTIVE is always visible", () => {
    expect(isHomeworkVisibleToStudents({ status: "ACTIVE", dueDate: new Date("2099-01-01T00:00:00Z") })).toBe(true);
  });
});

describe("Homework 2.0 — status transitions", () => {
  it("DRAFT can move to SCHEDULED, ACTIVE, or CANCELLED, but not directly to CLOSED", () => {
    expect(validateStatusTransition("DRAFT", "SCHEDULED")).toBeNull();
    expect(validateStatusTransition("DRAFT", "ACTIVE")).toBeNull();
    expect(validateStatusTransition("DRAFT", "CANCELLED")).toBeNull();
    expect(validateStatusTransition("DRAFT", "CLOSED")).toMatch(/Cannot move homework/);
  });

  it("SCHEDULED can move to ACTIVE or CANCELLED, but never back to DRAFT", () => {
    expect(validateStatusTransition("SCHEDULED", "ACTIVE")).toBeNull();
    expect(validateStatusTransition("SCHEDULED", "CANCELLED")).toBeNull();
    expect(validateStatusTransition("SCHEDULED", "DRAFT")).toMatch(/Cannot move homework/);
  });

  it("ACTIVE can move to CLOSED or CANCELLED", () => {
    expect(validateStatusTransition("ACTIVE", "CLOSED")).toBeNull();
    expect(validateStatusTransition("ACTIVE", "CANCELLED")).toBeNull();
    expect(validateStatusTransition("ACTIVE", "DRAFT")).toMatch(/Cannot move homework/);
  });

  it("CLOSED and CANCELLED are terminal — no transitions out", () => {
    expect(validateStatusTransition("CLOSED", "ACTIVE")).toMatch(/Cannot move homework/);
    expect(validateStatusTransition("CANCELLED", "ACTIVE")).toMatch(/Cannot move homework/);
    expect(validateStatusTransition("CLOSED", "CANCELLED")).toMatch(/Cannot move homework/);
  });
});

describe("Homework 2.0 — private remark never leaks", () => {
  it("omitPrivateRemark strips teacherRemark and keeps everything else", () => {
    const record = { id: "1", teacherRemark: "private note", studentFeedback: "great work", score: 9 };
    const result = omitPrivateRemark(record);
    expect(result).not.toHaveProperty("teacherRemark");
    expect(JSON.stringify(result)).not.toContain("private note");
    expect(result).toEqual({ id: "1", studentFeedback: "great work", score: 9 });
  });
});

describe("Homework 2.0 — marks only ever meaningful for GRADED", () => {
  it("shouldShowMaxMarks", () => {
    expect(shouldShowMaxMarks("GRADED")).toBe(true);
    expect(shouldShowMaxMarks("CHECKING_ONLY")).toBe(false);
  });
});

describe("Homework 2.0 — createHomeworkSchema (Zod)", () => {
  it("defaults assessmentMode to CHECKING_ONLY and status to ACTIVE when omitted (backward-compatible with pre-2.0 clients)", () => {
    const parsed = createHomeworkSchema.parse({
      sectionId: "sec1",
      subject: "Math",
      title: "HW",
      dueDate: "2026-01-01",
      deadlineAt: "2026-01-02",
    });
    expect(parsed.assessmentMode).toBe("CHECKING_ONLY");
    expect(parsed.status).toBe("ACTIVE");
  });

  it("rejects an unknown/extra field (never silently accepts a client-supplied schoolId/teacherId)", () => {
    const result = createHomeworkSchema.safeParse({
      sectionId: "sec1",
      subject: "Math",
      title: "HW",
      dueDate: "2026-01-01",
      deadlineAt: "2026-01-02",
      schoolId: "attacker-school",
      teacherId: "attacker-teacher",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(createHomeworkSchema.safeParse({ subject: "Math", title: "HW", dueDate: "2026-01-01", deadlineAt: "2026-01-02" }).success).toBe(false);
  });

  it("rejects an empty title/subject/sectionId", () => {
    expect(
      createHomeworkSchema.safeParse({ sectionId: "", subject: "Math", title: "HW", dueDate: "2026-01-01", deadlineAt: "2026-01-02" }).success
    ).toBe(false);
  });

  it("no silent default: deadlineAt is required — omitting it fails schema validation rather than defaulting to dueDate", () => {
    const result = createHomeworkSchema.safeParse({
      sectionId: "sec1",
      subject: "Math",
      title: "HW",
      dueDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("no silent default: an empty-string deadlineAt also fails schema validation", () => {
    const result = createHomeworkSchema.safeParse({
      sectionId: "sec1",
      subject: "Math",
      title: "HW",
      dueDate: "2026-01-01",
      deadlineAt: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("Homework 2.0 — editHomeworkSchema (Zod)", () => {
  it("every field is optional (a PATCH may update just one thing)", () => {
    expect(editHomeworkSchema.safeParse({}).success).toBe(true);
    expect(editHomeworkSchema.safeParse({ status: "CLOSED" }).success).toBe(true);
  });

  it("rejects an invalid status value", () => {
    expect(editHomeworkSchema.safeParse({ status: "PUBLISHED" }).success).toBe(false);
  });

  it("rejects an unknown/extra field", () => {
    expect(editHomeworkSchema.safeParse({ teacherId: "attacker" }).success).toBe(false);
  });
});
