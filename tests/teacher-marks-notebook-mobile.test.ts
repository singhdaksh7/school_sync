import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teacher: { findUnique: vi.fn() },
    timetableSlot: { findFirst: vi.fn() },
    examResult: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (arg) => Promise.all(arg)),
    student: { findMany: vi.fn() },
    notebookCheck: { findMany: vi.fn(), upsert: vi.fn() },
    examMilestone: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  sectionBelongsToSchool: vi.fn(),
  getExamInSchool: vi.fn(),
  allStudentsBelongToSchool: vi.fn(),
  examMilestoneBelongsToSchool: vi.fn(),
}));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/homework", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/homework");
  return { ...actual, getTeacherByUserId: vi.fn(), teacherCanTeachSubjectSection: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { allStudentsBelongToSchool, examMilestoneBelongsToSchool, getExamInSchool, sectionBelongsToSchool } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { getTeacherByUserId, teacherCanTeachSubjectSection } from "@/lib/homework";

const p = prisma as unknown as {
  teacher: { findUnique: ReturnType<typeof vi.fn> };
  timetableSlot: { findFirst: ReturnType<typeof vi.fn> };
  examResult: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
};
const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const getExamMock = getExamInSchool as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const getTeacherByUserIdMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const sectionBelongsToSchoolMock = sectionBelongsToSchool as unknown as ReturnType<typeof vi.fn>;
const allStudentsBelongToSchoolMock = allStudentsBelongToSchool as unknown as ReturnType<typeof vi.fn>;
const examMilestoneBelongsToSchoolMock = examMilestoneBelongsToSchool as unknown as ReturnType<typeof vi.fn>;
const teacherCanTeachSubjectSectionMock = teacherCanTeachSubjectSection as unknown as ReturnType<typeof vi.fn>;

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a", mentorSectionId: "sec-1" };

function jsonReq(url: string, body?: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  p.teacher.findUnique.mockResolvedValue(TEACHER_ROW);
  p.timetableSlot.findFirst.mockResolvedValue(null); // not assigned via timetable; mentorSectionId covers it
  getTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  teacherPermMock.mockResolvedValue(null);
  sectionBelongsToSchoolMock.mockResolvedValue(true);
  allStudentsBelongToSchoolMock.mockResolvedValue(true);
  examMilestoneBelongsToSchoolMock.mockResolvedValue(true);
  teacherCanTeachSubjectSectionMock.mockResolvedValue(true);
});

describe("Marks — explicit exam context still required", () => {
  it("GET requires both examId and sectionId (never inferred)", async () => {
    const { GET } = await import("@/app/api/teacher/results/route");
    const res = await GET(new Request("http://localhost/api/teacher/results"));
    expect(res.status).toBe(400);
  });

  it("POST requires examId, sectionId, and results array", async () => {
    const { POST } = await import("@/app/api/teacher/results/route");
    const res = await POST(jsonReq("http://localhost/api/teacher/results", { sectionId: "sec-1" }));
    expect(res.status).toBe(400);
  });

  it("caps a submitted mark at the exam's maxMarks (unchanged calculation)", async () => {
    getExamMock.mockResolvedValue({ id: "exam-1", maxMarks: 50 });
    const { POST } = await import("@/app/api/teacher/results/route");
    const res = await POST(
      jsonReq("http://localhost/api/teacher/results", { examId: "exam-1", sectionId: "sec-1", results: [{ studentId: "stu-1", marks: 999 }] })
    );
    expect(res.status).toBe(200);
    expect(p.examResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ marks: 50, submittedById: "user-1" }) })
    );
  });

  it("MARKS:ENTER permission denial is preserved", async () => {
    getExamMock.mockResolvedValue({ id: "exam-1", maxMarks: 50 });
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { POST } = await import("@/app/api/teacher/results/route");
    const res = await POST(
      jsonReq("http://localhost/api/teacher/results", { examId: "exam-1", sectionId: "sec-1", results: [{ studentId: "stu-1", marks: 10 }] })
    );
    expect(res.status).toBe(403);
  });

  it("section not assigned to this teacher (via timetable or mentor) is denied", async () => {
    p.teacher.findUnique.mockResolvedValueOnce({ ...TEACHER_ROW, mentorSectionId: "other-section" });
    const { POST } = await import("@/app/api/teacher/results/route");
    const res = await POST(
      jsonReq("http://localhost/api/teacher/results", { examId: "exam-1", sectionId: "sec-1", results: [{ studentId: "stu-1", marks: 10 }] })
    );
    expect(res.status).toBe(403);
  });
});

describe("Notebook — feature/permission/scope preserved", () => {
  it("NOTEBOOK_CHECKING feature denial is preserved", async () => {
    const featureMock = (await import("@/lib/feature-flags")).requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
    featureMock.mockResolvedValueOnce(NextResponse.json({ error: "disabled" }, { status: 403 }));
    const { GET } = await import("@/app/api/teacher/notebook/route");
    const res = await GET(new Request("http://localhost/api/teacher/notebook?sectionId=sec-1&subject=Math&examMilestoneId=m1"));
    expect(res.status).toBe(403);
  });

  it("NOTEBOOK:VIEW permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { GET } = await import("@/app/api/teacher/notebook/route");
    const res = await GET(new Request("http://localhost/api/teacher/notebook?sectionId=sec-1&subject=Math&examMilestoneId=m1"));
    expect(res.status).toBe(403);
  });

  it("requires sectionId, subject, and examMilestoneId", async () => {
    const { GET } = await import("@/app/api/teacher/notebook/route");
    const res = await GET(new Request("http://localhost/api/teacher/notebook"));
    expect(res.status).toBe(400);
  });
});
