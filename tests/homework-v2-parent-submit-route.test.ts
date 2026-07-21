import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/parent-auth", () => ({
  getAuthenticatedGuardian: vi.fn(),
  guardianCanAccessStudent: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/file-service", () => ({ resolveManagedOrLegacyUrl: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    storedFile: { findFirst: vi.fn() },
    homework: { findFirst: vi.fn() },
    student: { findFirst: vi.fn() },
    homeworkStudentStatus: { findUnique: vi.fn(), upsert: vi.fn() },
    homeworkSubmission: { upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txProxy)),
  },
}));

import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { prisma } from "@/lib/prisma";

const getAuthenticatedGuardianMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;
const guardianCanAccessStudentMock = guardianCanAccessStudent as unknown as ReturnType<typeof vi.fn>;

const txProxy = {
  homeworkSubmission: {
    upsert: vi.fn(async () => ({
      id: "sub-1",
      homeworkId: "hw-1",
      studentId: "stu-1",
      attachmentUrl: null,
      attachmentFileId: "file-1",
      // A private teacher remark from a prior review cycle — a resubmission
      // upsert must never let this leak into the guardian-facing response,
      // regardless of whether the upsert's `update` branch clears it.
      teacherRemark: "Handwriting is messy",
      studentFeedback: "Nice work, keep practicing",
      score: null,
      maxScore: null,
    })),
  },
  homeworkStudentStatus: { upsert: vi.fn(async () => ({})) },
};

const p = prisma as unknown as {
  homework: { findFirst: ReturnType<typeof vi.fn> };
  student: { findFirst: ReturnType<typeof vi.fn> };
  homeworkStudentStatus: { findUnique: ReturnType<typeof vi.fn> };
  storedFile: { findFirst: ReturnType<typeof vi.fn> };
};

const GUARDIAN_AUTH = { guardian: { id: "guardian-1", schoolId: "school-a" } };
const HOMEWORK = {
  id: "hw-1",
  schoolId: "school-a",
  sectionId: "sec-1",
  dueDate: new Date("2026-01-01T00:00:00.000Z"),
  deadlineAt: new Date("2099-01-01T00:00:00.000Z"),
  status: "ACTIVE",
};

function submitReq(body: unknown) {
  return new NextRequest("http://localhost/api/parent/homework/hw-1/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedGuardianMock.mockResolvedValue(GUARDIAN_AUTH);
  guardianCanAccessStudentMock.mockResolvedValue(true);
  p.homework.findFirst.mockResolvedValue(HOMEWORK);
  p.student.findFirst.mockResolvedValue({ id: "stu-1" });
  p.homeworkStudentStatus.findUnique.mockResolvedValue(null);
  p.storedFile.findFirst.mockResolvedValue({ id: "file-1", originalFilename: "hw.pdf", contentType: "application/pdf" });
  txProxy.homeworkSubmission.upsert.mockClear();
});

describe("POST /api/parent/homework/[homeworkId]/submit — private-remark hardening", () => {
  it("never exposes teacherRemark in the response, even though studentFeedback remains available", async () => {
    const { POST } = await import("@/app/api/parent/homework/[homeworkId]/submit/route");
    const res = await POST(submitReq({ studentId: "stu-1", attachmentFileId: "file-1" }), {
      params: Promise.resolve({ homeworkId: "hw-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.submission).not.toHaveProperty("teacherRemark");
    expect(JSON.stringify(body)).not.toContain("Handwriting is messy");
    expect(body.submission.studentFeedback).toBe("Nice work, keep practicing");
  });
});
