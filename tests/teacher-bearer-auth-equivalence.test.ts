import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXTAUTH_SECRET = "test-secret-for-equivalence-suite";

// This suite exercises the REAL getTeacherAuth/getMobileAuth resolution
// chain (not a mocked role string) against real JWTs, to prove authentication
// EQUIVALENCE: a bearer mobile Teacher and a NextAuth web Teacher resolve to
// the identical {userId, teacherId, schoolId} canonical context, and that a
// bearer Student/Parent/Admin token can never become a Teacher actor on a
// Teacher-only route.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findFirst: vi.fn(), findUnique: vi.fn() },
    teacher: { findFirst: vi.fn(), findUnique: vi.fn() },
    student: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    attendance: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  sessionRole: (u: { role?: string }) => u?.role,
  allStudentsBelongToSchool: vi.fn(),
  // getTeacherAuth's NextAuth fallback path resolves the teacher this way.
  getActiveTeacherByUserId: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generateMobileToken } from "@/lib/mobile-auth";
import { generateParentToken } from "@/lib/parent-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { allStudentsBelongToSchool, getActiveTeacherByUserId } from "@/lib/tenant";
import { GET as attendanceGet, POST as attendancePost } from "@/app/api/teacher/attendance/route";

const p = prisma as unknown as {
  school: { findFirst: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  attendance: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
};
const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const getActiveTeacherByUserIdMock = getActiveTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const allStudentsBelongToSchoolMock = allStudentsBelongToSchool as unknown as ReturnType<typeof vi.fn>;

const ACTIVE_SCHOOL = { id: "school-a", name: "School A", slug: "school-a", logoUrl: null, status: "ACTIVE" };
const TEACHER_ROW = { id: "teacher-1", userId: "user-1", schoolId: "school-a", mentorSectionId: "sec-1", isDeleted: false };

function bearerReq(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — clearAllMocks only clears call history
  // and would let a mockResolvedValue configured in one test (e.g. authMock in
  // the NextAuth-equivalence test) silently leak into later, unrelated tests.
  vi.resetAllMocks();
  p.school.findFirst.mockResolvedValue(ACTIVE_SCHOOL);
  p.teacher.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.userId === "user-1" || where.id === "teacher-1") return TEACHER_ROW;
    return null;
  });
  p.teacher.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.userId === "user-1" || where.id === "teacher-1") return TEACHER_ROW;
    return null;
  });
  p.attendance.findMany.mockResolvedValue([]);
  p.attendance.upsert.mockResolvedValue({});
  teacherPermMock.mockResolvedValue(null);
  getActiveTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  allStudentsBelongToSchoolMock.mockResolvedValue(true);
});

describe("Class attendance — bearer mobile Teacher accepted", () => {
  it("a real bearer Teacher JWT resolves and reaches the business logic", async () => {
    const token = generateMobileToken({ type: "mobile", role: "TEACHER", userId: "user-1", teacherId: "teacher-1", schoolId: "school-a", schoolSlug: "school-a", name: "T. Teacher" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(200);
    expect(p.attendance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ schoolId: "school-a", sectionId: "sec-1" }) }));
  });

  it("marking attendance via bearer Teacher preserves markedById as the resolved teacher's userId", async () => {
    const token = generateMobileToken({ type: "mobile", role: "TEACHER", userId: "user-1", teacherId: "teacher-1", schoolId: "school-a", schoolSlug: "school-a", name: "T. Teacher" });
    const res = await attendancePost(
      bearerReq("http://localhost/api/teacher/attendance", token, {
        method: "POST",
        body: JSON.stringify({ date: "2026-07-06", records: [{ id: "stu-1", status: "PRESENT" }] }),
      })
    );
    expect(res.status).toBe(200);
    expect(p.attendance.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ markedById: "user-1", schoolId: "school-a", sectionId: "sec-1" }) }));
  });
});

describe("Class attendance — NextAuth web Teacher still accepted (equivalence)", () => {
  it("resolves the identical canonical context via the NextAuth fallback path", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "TEACHER" } });
    const res = await attendanceGet(new Request("http://localhost/api/teacher/attendance"));
    expect(res.status).toBe(200);
    expect(p.attendance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ schoolId: "school-a", sectionId: "sec-1" }) }));
  });
});

describe("Class attendance — actor isolation", () => {
  it("denies a bearer Student token", async () => {
    const token = generateMobileToken({ type: "mobile", role: "STUDENT", studentId: "stu-1", schoolId: "school-a", schoolSlug: "school-a", name: "S. Student" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(401);
    expect(p.attendance.findMany).not.toHaveBeenCalled();
  });

  it("denies a bearer Parent token", async () => {
    const token = generateParentToken({ guardianId: "g-1", name: "G. Guardian", phone: "+911234567890", role: "PARENT", schoolId: "school-a", schoolSlug: "school-a" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(401);
  });

  it("denies a bearer School Owner/Admin/VP token (staff login shares the endpoint, not the Teacher route)", async () => {
    for (const role of ["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"] as const) {
      const token = generateMobileToken({ type: "mobile", role, userId: "admin-1", schoolId: "school-a", schoolSlug: "school-a", name: "Admin" });
      const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
      expect(res.status).toBe(401);
    }
  });

  it("denies a cross-tenant Teacher (JWT school does not match the resolved teacher's actual school)", async () => {
    p.teacher.findFirst.mockResolvedValue(null); // getMobileAuth's teacher lookup is schoolId-scoped; a mismatched token finds nothing
    const token = generateMobileToken({ type: "mobile", role: "TEACHER", userId: "user-1", teacherId: "teacher-1", schoolId: "school-b", schoolSlug: "school-b", name: "T. Teacher" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(401);
  });
});

describe("Class attendance — feature/permission/scope still enforced for bearer callers", () => {
  it("ATTENDANCE feature denial is preserved", async () => {
    const featureMock = (await import("@/lib/feature-flags")).requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
    const { NextResponse } = await import("next/server");
    featureMock.mockResolvedValueOnce(NextResponse.json({ error: "disabled" }, { status: 403 }));

    const token = generateMobileToken({ type: "mobile", role: "TEACHER", userId: "user-1", teacherId: "teacher-1", schoolId: "school-a", schoolSlug: "school-a", name: "T" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(403);
  });

  it("permission denial (ATTENDANCE:VIEW) is preserved", async () => {
    const { NextResponse } = await import("next/server");
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

    const token = generateMobileToken({ type: "mobile", role: "TEACHER", userId: "user-1", teacherId: "teacher-1", schoolId: "school-a", schoolSlug: "school-a", name: "T" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(403);
  });

  it("no mentor section assigned is preserved (400, unrelated to auth transport)", async () => {
    p.teacher.findUnique.mockResolvedValueOnce({ ...TEACHER_ROW, mentorSectionId: null });
    const token = generateMobileToken({ type: "mobile", role: "TEACHER", userId: "user-1", teacherId: "teacher-1", schoolId: "school-a", schoolSlug: "school-a", name: "T" });
    const res = await attendanceGet(bearerReq("http://localhost/api/teacher/attendance", token));
    expect(res.status).toBe(400);
  });
});
