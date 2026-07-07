import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/mobile-auth", () => ({ getTeacherAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/teacher-authorization", () => ({ requireTeacherPermission: vi.fn(async () => null) }));
vi.mock("@/lib/homework", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/homework");
  return { ...actual, getTeacherByUserId: vi.fn(), getHomeworkForTeacherAccess: vi.fn() };
});
vi.mock("@/lib/api-cost-guard", () => ({ enforceUploadQuota: vi.fn(async () => null) }));
vi.mock("@/lib/file-service", () => ({
  readUploadedFile: vi.fn(),
  uploadManagedFile: vi.fn(),
  resolveDownloadUrl: vi.fn(),
  resolveManagedOrLegacyUrl: vi.fn(),
}));
vi.mock("@/lib/file-retention", () => ({ homeworkAttachmentRetention: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { homework: { update: vi.fn() } } }));

import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { getHomeworkForTeacherAccess, getTeacherByUserId } from "@/lib/homework";
import { enforceUploadQuota } from "@/lib/api-cost-guard";
import { readUploadedFile, resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";
import { prisma } from "@/lib/prisma";

const getTeacherAuthMock = getTeacherAuth as unknown as ReturnType<typeof vi.fn>;
const teacherPermMock = requireTeacherPermission as unknown as ReturnType<typeof vi.fn>;
const getHomeworkForTeacherAccessMock = getHomeworkForTeacherAccess as unknown as ReturnType<typeof vi.fn>;
const getTeacherByUserIdMock = getTeacherByUserId as unknown as ReturnType<typeof vi.fn>;
const uploadQuotaMock = enforceUploadQuota as unknown as ReturnType<typeof vi.fn>;
const readUploadedFileMock = readUploadedFile as unknown as ReturnType<typeof vi.fn>;
const uploadManagedFileMock = uploadManagedFile as unknown as ReturnType<typeof vi.fn>;
const resolveDownloadUrlMock = resolveDownloadUrl as unknown as ReturnType<typeof vi.fn>;
const p = prisma as unknown as { homework: { update: ReturnType<typeof vi.fn> } };

const TEACHER_AUTH = { userId: "user-1", teacherId: "teacher-1", schoolId: "school-a" };
const TEACHER_ROW = { id: "teacher-1", schoolId: "school-a" };
const HOMEWORK = { id: "hw-1", schoolId: "school-a", sectionId: "sec-1", status: "ACTIVE", dueDate: new Date("2026-01-01") };

function uploadReq(url: string, formData: FormData) {
  return new Request(url, { method: "POST", body: formData });
}

beforeEach(() => {
  vi.resetAllMocks();
  getTeacherAuthMock.mockResolvedValue(TEACHER_AUTH);
  getTeacherByUserIdMock.mockResolvedValue(TEACHER_ROW);
  getHomeworkForTeacherAccessMock.mockResolvedValue(HOMEWORK);
  teacherPermMock.mockResolvedValue(null);
  uploadQuotaMock.mockResolvedValue(null);
  readUploadedFileMock.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), filename: "notes.pdf", declaredContentType: "application/pdf" });
  resolveDownloadUrlMock.mockResolvedValue("https://signed.example.com/file");
  p.homework.update.mockResolvedValue({});
});

describe("POST /api/teacher/homework/[homeworkId]/attachment", () => {
  it("an authorized Teacher's upload succeeds and returns the managed file response shape, no storageKey", async () => {
    uploadManagedFileMock.mockResolvedValue({ ok: true, file: { id: "file-1", contentType: "application/pdf", storageKey: "homework_attachment/school-a/2026/notes.pdf" } });

    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "application/pdf" }), "notes.pdf");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ file: { id: "file-1", url: "https://signed.example.com/file", contentType: "application/pdf" } });
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(p.homework.update).toHaveBeenCalledWith({ where: { id: "hw-1" }, data: { attachmentFileId: "file-1" } });
  });

  it("uses the HOMEWORK_ATTACHMENT category and quota (not HOMEWORK_SUBMISSION)", async () => {
    uploadManagedFileMock.mockResolvedValue({ ok: true, file: { id: "file-1", contentType: "application/pdf" } });
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["hello"]), "notes.pdf");
    await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });

    expect(uploadQuotaMock).toHaveBeenCalledWith(expect.objectContaining({ schoolId: "school-a", actorType: "TEACHER" }), "HOMEWORK_ATTACHMENT");
    expect(uploadManagedFileMock).toHaveBeenCalledWith(expect.objectContaining({ category: "HOMEWORK_ATTACHMENT", schoolId: "school-a" }));
  });

  it("denies an unauthorized Teacher (not owner/not assigned to this homework's section)", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["hello"]), "notes.pdf");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(404);
    expect(uploadManagedFileMock).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated request (no teacher context at all)", async () => {
    getTeacherAuthMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["hello"]), "notes.pdf");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid/oversized file via the canonical validateUpload result (surfaced by uploadManagedFile)", async () => {
    uploadManagedFileMock.mockResolvedValue({ ok: false, status: 400, error: "File type not allowed for this category" });
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["x"]), "virus.exe");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(400);
    expect(p.homework.update).not.toHaveBeenCalled();
  });

  it("preserves an upload quota denial", async () => {
    uploadQuotaMock.mockResolvedValueOnce(NextResponse.json({ error: "Upload quota exceeded", code: "UPLOAD_QUOTA_EXCEEDED" }, { status: 429 }));
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["x"]), "notes.pdf");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(429);
    expect(uploadManagedFileMock).not.toHaveBeenCalled();
  });

  it("HOMEWORK:EDIT permission denial is preserved", async () => {
    teacherPermMock.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["x"]), "notes.pdf");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(403);
  });

  it("cancelled homework cannot receive a new attachment", async () => {
    getHomeworkForTeacherAccessMock.mockResolvedValue({ ...HOMEWORK, status: "CANCELLED" });
    const { POST } = await import("@/app/api/teacher/homework/[homeworkId]/attachment/route");
    const form = new FormData();
    form.append("file", new Blob(["x"]), "notes.pdf");
    const res = await POST(uploadReq("http://localhost/x", form), { params: Promise.resolve({ homeworkId: "hw-1" }) });
    expect(res.status).toBe(400);
  });
});

// The "deleted managed file never falls back to a stale legacy URL" semantic
// is already exhaustively covered against the REAL resolveManagedOrLegacyUrl
// implementation in tests/wave-b-attachment-resolution.test.ts — not
// duplicated here against a mock, since this file mocks @/lib/file-service.
