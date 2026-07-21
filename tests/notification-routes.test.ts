import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@/lib/parent-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parent-auth")>("@/lib/parent-auth");
  return { ...actual, getAuthenticatedGuardian: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ sessionRole: (u: { role?: string }) => u?.role }));
vi.mock("@/lib/teacher-authorization", () => ({ requireSchoolAccess: vi.fn() }));
vi.mock("@/lib/notification-queries", () => ({
  listNotificationsForRecipient: vi.fn(async () => ({ items: [], nextCursor: null })),
  unreadNotificationCount: vi.fn(async () => 0),
  markNotificationRead: vi.fn(async () => ({ ok: true })),
  markAllNotificationsRead: vi.fn(async () => ({ count: 0 })),
}));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { auth } from "@/lib/auth";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { listNotificationsForRecipient, markNotificationRead } from "@/lib/notification-queries";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const getGuardianAuthMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;
const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const accessMock = requireSchoolAccess as unknown as ReturnType<typeof vi.fn>;
const featureMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const listMock = listNotificationsForRecipient as unknown as ReturnType<typeof vi.fn>;
const readMock = markNotificationRead as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  featureMock.mockResolvedValue(null);
  listMock.mockResolvedValue({ items: [], nextCursor: null });
  readMock.mockResolvedValue({ ok: true });
});

describe("GET /api/teacher/notifications", () => {
  it("401s with no bearer/session auth", async () => {
    getTeacherAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/teacher/notifications/route");
    const res = await GET(new Request("http://localhost/api/teacher/notifications"));
    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("scopes the list call to the resolved teacher's own teacherId + schoolId — never a client-supplied recipient", async () => {
    getTeacherAuthMock.mockResolvedValue({ userId: "u1", teacherId: "teacher-1", schoolId: "school-a" });
    const { GET } = await import("@/app/api/teacher/notifications/route");
    const res = await GET(new Request("http://localhost/api/teacher/notifications?recipientId=attacker-supplied&schoolId=other-school"));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a", recipient: { recipientType: "TEACHER", recipientId: "teacher-1" } }));
  });

  it("honors the NOTIFICATIONS feature-flag gate", async () => {
    getTeacherAuthMock.mockResolvedValue({ userId: "u1", teacherId: "teacher-1", schoolId: "school-a" });
    const { NextResponse } = await import("next/server");
    featureMock.mockResolvedValueOnce(NextResponse.json({ error: "disabled" }, { status: 403 }));
    const { GET } = await import("@/app/api/teacher/notifications/route");
    const res = await GET(new Request("http://localhost/api/teacher/notifications"));
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/teacher/notifications/[notificationId]/read", () => {
  it("returns 404 (non-enumerating) when the notification isn't this teacher's/school's", async () => {
    getTeacherAuthMock.mockResolvedValue({ userId: "u1", teacherId: "teacher-1", schoolId: "school-a" });
    readMock.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const { PATCH } = await import("@/app/api/teacher/notifications/[notificationId]/read/route");
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH" }), { params: Promise.resolve({ notificationId: "foreign-id" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/student/notifications", () => {
  it("401s without student auth", async () => {
    getStudentAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/student/notifications/route");
    const res = await GET(new Request("http://localhost/api/student/notifications"));
    expect(res.status).toBe(401);
  });

  it("scopes to the resolved student's own studentId", async () => {
    getStudentAuthMock.mockResolvedValue({ studentId: "st1", schoolId: "school-a" });
    const { GET } = await import("@/app/api/student/notifications/route");
    const res = await GET(new Request("http://localhost/api/student/notifications"));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ recipient: { recipientType: "STUDENT", recipientId: "st1" } }));
  });
});

describe("GET /api/parent/notifications", () => {
  it("401s without a valid guardian bearer token", async () => {
    getGuardianAuthMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/parent/notifications/route");
    const res = await GET(new NextRequest("http://localhost/api/parent/notifications"));
    expect(res.status).toBe(401);
  });

  it("scopes to the resolved guardian's own guardianId, never a client-supplied one", async () => {
    getGuardianAuthMock.mockResolvedValue({ decoded: { guardianId: "g1" }, guardian: { id: "g1", schoolId: "school-a" } });
    const { GET } = await import("@/app/api/parent/notifications/route");
    const res = await GET(new NextRequest("http://localhost/api/parent/notifications?guardianId=someone-else"));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ recipient: { recipientType: "GUARDIAN", recipientId: "g1" } }));
  });
});

describe("GET /api/schools/[schoolId]/notifications — admin personal inbox", () => {
  it("401s without a session", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/schools/[schoolId]/notifications/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(401);
  });

  it("scopes to the authenticated admin's own userId — never a client-supplied recipient", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "SCHOOL_ADMIN" } });
    accessMock.mockResolvedValue({ ok: true, teacherId: null });
    const { GET } = await import("@/app/api/schools/[schoolId]/notifications/route");
    const res = await GET(new Request("http://localhost/x?recipientId=someone-else"), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a", recipient: { recipientType: "ADMIN_STAFF", recipientId: "admin-1" } }));
  });

  it("rejects a teacher actor — teachers use /api/teacher/notifications instead", async () => {
    authMock.mockResolvedValue({ user: { id: "teacher-user-1", role: "TEACHER" } });
    accessMock.mockResolvedValue({ ok: true, teacherId: "teacher-1" });
    const { GET } = await import("@/app/api/schools/[schoolId]/notifications/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ schoolId: "school-a" }) });
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });
});
