import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({ prisma: { exam: { findMany: vi.fn() } } }));
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/homework", () => ({ getTeacherByUserId: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { getTeacherByUserId } from "@/lib/homework";
import { GET } from "@/app/api/teacher/exams/route";

const p = prisma as unknown as { exam: { findMany: ReturnType<typeof vi.fn> } };
const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const getTeacherByUserIdMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a" };

const EXAMS = [
  { id: "exam-1", name: "Midterm", maxMarks: 50, schemeId: "scheme-1", scheme: { name: "Annual" } },
  { id: "exam-2", name: "Final", maxMarks: 100, schemeId: "scheme-1", scheme: { name: "Annual" } },
];

function req() {
  return new Request("http://localhost/api/teacher/exams");
}

beforeEach(() => {
  vi.clearAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  getTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  teacherPermMock.mockResolvedValue(null);
  p.exam.findMany.mockResolvedValue(EXAMS);
});

describe("GET /api/teacher/exams", () => {
  it("returns the school's exams with bounded, real fields", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exams).toEqual([
      { id: "exam-1", name: "Midterm", maxMarks: 50, examSchemeId: "scheme-1", examSchemeName: "Annual" },
      { id: "exam-2", name: "Final", maxMarks: 100, examSchemeId: "scheme-1", examSchemeName: "Annual" },
    ]);
  });

  it("scopes the query to the authenticated teacher's own school only", async () => {
    await GET(req());
    expect(p.exam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scheme: { schoolId: "school-a" } } })
    );
  });

  it("never marks any exam as current/active/default/selected", async () => {
    const res = await GET(req());
    const body = await res.json();
    for (const exam of body.exams) {
      expect(exam).not.toHaveProperty("current");
      expect(exam).not.toHaveProperty("active");
      expect(exam).not.toHaveProperty("default");
      expect(exam).not.toHaveProperty("selected");
    }
  });

  it("MARKS:VIEW permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(p.exam.findMany).not.toHaveBeenCalled();
  });

  it("unauthenticated request is denied", async () => {
    getTeacherAuthMock.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
