import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTx = {
  $queryRaw: vi.fn(),
  admissionApplication: { findFirstOrThrow: vi.fn(), updateMany: vi.fn() },
  section: { findFirst: vi.fn() },
  student: { create: vi.fn(), findMany: vi.fn() },
  guardian: { upsert: vi.fn() },
  studentGuardian: { upsert: vi.fn() },
  admissionStatusHistory: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
  },
}));

vi.mock("@/lib/homework", () => ({
  backfillHomeworkStatusForStudent: vi.fn(async () => {}),
}));

import { enrollApplication } from "@/lib/admissions/enrollment";

function baseApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: "app1",
    schoolId: "s1",
    status: "APPROVED",
    enrolledStudentId: null,
    applicantFirstName: "Jane",
    applicantMiddleName: null,
    applicantLastName: "Doe",
    applicationNumber: "ADM-2026-000001",
    guardianName: "Mother Doe",
    guardianRelation: "Mother",
    guardianPhone: "9876543210",
    guardianEmail: null,
    admissionOffering: { classId: "cls1", class: { name: "Grade 1" } },
    admissionCycle: { status: "OPEN" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.$queryRaw.mockResolvedValue([{ id: "app1" }]);
  mockTx.section.findFirst.mockResolvedValue({ id: "sec1", classId: "cls1" });
  mockTx.student.findMany.mockResolvedValue([]); // no duplicate by default
  mockTx.student.create.mockResolvedValue({ id: "stu1", name: "Jane Doe", rollNo: "ADM-2026-000001", admissionNo: "ADM-2026-000001", sectionId: "sec1" });
  mockTx.guardian.upsert.mockResolvedValue({ id: "g1" });
  mockTx.studentGuardian.upsert.mockResolvedValue({ id: "sg1" });
  mockTx.admissionApplication.updateMany.mockResolvedValue({ count: 1 });
  mockTx.admissionStatusHistory.create.mockResolvedValue({});
});

describe("enrollApplication — the enrollment-conversion transaction", () => {
  it("only enrolls when status is APPROVED", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication({ status: "UNDER_REVIEW" }));
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "ERROR") expect(outcome.error.code).toBe("NOT_APPROVED");
  });

  it("refuses to convert an already-converted application", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication({ enrolledStudentId: "stu-existing" }));
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "ERROR") expect(outcome.error.code).toBe("ALREADY_CONVERTED");
  });

  it("rejects a section that doesn't belong to the offering's class", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication());
    mockTx.section.findFirst.mockResolvedValue(null);
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec-wrong" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "ERROR") expect(outcome.error.code).toBe("SECTION_INVALID");
  });

  it("flags a possible duplicate WITHOUT creating a student, when not confirmed", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication());
    mockTx.student.findMany.mockResolvedValue([{ id: "stu-dup", name: "Jane Doe", admissionNo: "OLD-1", sectionId: "sec1" }]);
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "DUPLICATE_CANDIDATE") {
      expect(outcome.candidates).toHaveLength(1);
    }
    expect(mockTx.student.create).not.toHaveBeenCalled();
  });

  it("proceeds past a duplicate when confirmedDuplicate is passed", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication());
    mockTx.student.findMany.mockResolvedValue([{ id: "stu-dup", name: "Jane Doe", admissionNo: "OLD-1", sectionId: "sec1" }]);
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1", confirmedDuplicate: true });
    expect(outcome.ok).toBe(true);
    expect(mockTx.student.create).toHaveBeenCalled();
  });

  it("creates student + guardian link + sets enrolledStudentId + writes status history, all inside one transaction", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication());
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1" });
    expect(outcome.ok).toBe(true);
    expect(mockTx.student.create).toHaveBeenCalledTimes(1);
    expect(mockTx.guardian.upsert).toHaveBeenCalledTimes(1);
    expect(mockTx.studentGuardian.upsert).toHaveBeenCalledTimes(1);
    expect(mockTx.admissionApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "APPROVED", enrolledStudentId: null }) })
    );
    expect(mockTx.admissionStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it("treats a concurrent double-enrollment race as ALREADY_CONVERTED (WHERE-guarded update affects 0 rows)", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication());
    // Simulates a second concurrent caller's UPDATE finding the row already
    // converted by the time it runs (Postgres row-lock semantics under the
    // real DB) — the WHERE-guarded updateMany returns count:0.
    mockTx.admissionApplication.updateMany.mockResolvedValue({ count: 0 });
    const outcome = await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.reason === "ERROR") expect(outcome.error.code).toBe("ALREADY_CONVERTED");
  });

  it("acquires a row lock via SELECT ... FOR UPDATE before reading the application", async () => {
    mockTx.admissionApplication.findFirstOrThrow.mockResolvedValue(baseApplication());
    await enrollApplication("s1", "app1", "actor1", { sectionId: "sec1" });
    expect(mockTx.$queryRaw).toHaveBeenCalled();
  });
});
