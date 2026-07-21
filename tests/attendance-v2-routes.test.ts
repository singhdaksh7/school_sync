import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { teacher: { findUnique: vi.fn() } } }));
vi.mock("@/lib/attendance-sessions", () => ({
  submitAttendanceSession: vi.fn(),
  saveAttendanceDraft: vi.fn(),
  loadAttendanceRosterView: vi.fn(),
  ATTENDANCE_STATUS_VALUES: ["PRESENT", "ABSENT", "LATE", "ON_LEAVE"],
}));
vi.mock("@/lib/operational-authorization", () => ({ requireSchoolAccessOrOperationalCapability: vi.fn() }));
vi.mock("@/lib/operations-bearer-auth", () => ({ resolveOperationsActor: vi.fn() }));
vi.mock("@/lib/attendance-corrections", () => ({ reviewCorrectionRequest: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { submitAttendanceSession, saveAttendanceDraft } from "@/lib/attendance-sessions";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { reviewCorrectionRequest } from "@/lib/attendance-corrections";

const p = prisma as unknown as { teacher: { findUnique: ReturnType<typeof vi.fn> } };
const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const submitMock = submitAttendanceSession as unknown as ReturnType<typeof vi.fn>;
const draftMock = saveAttendanceDraft as unknown as ReturnType<typeof vi.fn>;
const accessMock = requireSchoolAccessOrOperationalCapability as unknown as ReturnType<typeof vi.fn>;
const actorMock = resolveOperationsActor as unknown as ReturnType<typeof vi.fn>;
const reviewMock = reviewCorrectionRequest as unknown as ReturnType<typeof vi.fn>;

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a", mentorSectionId: "sec1" };

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  p.teacher.findUnique.mockResolvedValue(TEACHER_ROW);
});

describe("POST /api/teacher/attendance/submit", () => {
  it("returns 200 on a complete roster submission", async () => {
    submitMock.mockResolvedValue({ ok: true, submittedCount: 2 });
    const { POST } = await import("@/app/api/teacher/attendance/submit/route");
    const res = await POST(jsonReq("http://localhost/api/teacher/attendance/submit", { date: "2026-01-05" }));
    expect(res.status).toBe(200);
  });

  it("returns 400 with the missing student list on an incomplete roster", async () => {
    submitMock.mockResolvedValue({ ok: false, code: "INCOMPLETE_ROSTER", missingStudentIds: ["st2"], extraStudentIds: [] });
    const { POST } = await import("@/app/api/teacher/attendance/submit/route");
    const res = await POST(jsonReq("http://localhost/api/teacher/attendance/submit", { date: "2026-01-05" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.missingStudentIds).toEqual(["st2"]);
  });

  it("returns 409 (clear conflict, no enumeration of internals) when already submitted", async () => {
    submitMock.mockResolvedValue({ ok: false, code: "ALREADY_SUBMITTED" });
    const { POST } = await import("@/app/api/teacher/attendance/submit/route");
    const res = await POST(jsonReq("http://localhost/api/teacher/attendance/submit", { date: "2026-01-05" }));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/teacher/attendance — draft write conflict once locked", () => {
  it("returns 409 when the session is already SUBMITTED — changes nothing", async () => {
    draftMock.mockResolvedValue({ ok: false, code: "SESSION_LOCKED" });
    const { POST } = await import("@/app/api/teacher/attendance/route");
    const res = await POST(
      jsonReq("http://localhost/api/teacher/attendance", { date: "2026-01-05", records: [{ id: "st1", status: "PRESENT" }] })
    );
    expect(res.status).toBe(409);
  });

  it("rejects a client-supplied extra field via strict schema validation", async () => {
    const { POST } = await import("@/app/api/teacher/attendance/route");
    const res = await POST(
      jsonReq("http://localhost/api/teacher/attendance", {
        date: "2026-01-05",
        schoolId: "attacker-supplied",
        records: [{ id: "st1", status: "PRESENT" }],
      })
    );
    expect(res.status).toBe(400);
    expect(draftMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/schools/[schoolId]/attendance/corrections/[correctionId] — authorization + conflict wiring", () => {
  it("returns 403 with SELF_CORRECTION_APPROVAL_FORBIDDEN when the acting teacher requested it themselves", async () => {
    actorMock.mockResolvedValue({ userId: "user-1", role: "TEACHER" });
    accessMock.mockResolvedValue({ ok: true, teacherId: "teacher-1", operational: null });
    reviewMock.mockResolvedValue({ ok: false, code: "SELF_APPROVAL_FORBIDDEN" });

    const { PATCH } = await import("@/app/api/schools/[schoolId]/attendance/corrections/[correctionId]/route");
    const res = await PATCH(jsonReq("http://localhost/x", { action: "APPROVE" }), {
      params: Promise.resolve({ schoolId: "school-a", correctionId: "corr-1" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.reasonCode).toBe("SELF_CORRECTION_APPROVAL_FORBIDDEN");
  });

  it("returns 409 with conflicting student ids when the original status no longer matches", async () => {
    actorMock.mockResolvedValue({ userId: "admin-1", role: "SCHOOL_ADMIN" });
    accessMock.mockResolvedValue({ ok: true, teacherId: null, operational: null });
    reviewMock.mockResolvedValue({ ok: false, code: "STATUS_CONFLICT", conflictingStudentIds: ["st1"] });

    const { PATCH } = await import("@/app/api/schools/[schoolId]/attendance/corrections/[correctionId]/route");
    const res = await PATCH(jsonReq("http://localhost/x", { action: "APPROVE" }), {
      params: Promise.resolve({ schoolId: "school-a", correctionId: "corr-1" }),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.conflictingStudentIds).toEqual(["st1"]);
  });

  it("returns 200 idempotently when the request was already in a final state", async () => {
    actorMock.mockResolvedValue({ userId: "admin-1", role: "SCHOOL_ADMIN" });
    accessMock.mockResolvedValue({ ok: true, teacherId: null, operational: null });
    reviewMock.mockResolvedValue({ ok: true, status: "APPROVED", alreadyFinal: true });

    const { PATCH } = await import("@/app/api/schools/[schoolId]/attendance/corrections/[correctionId]/route");
    const res = await PATCH(jsonReq("http://localhost/x", { action: "APPROVE" }), {
      params: Promise.resolve({ schoolId: "school-a", correctionId: "corr-1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.alreadyFinal).toBe(true);
  });
});
