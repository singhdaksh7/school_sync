import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    feeStructure: { findMany: vi.fn() },
    feePayment: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));

import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { GET } from "@/app/api/student/fees/route";

const p = prisma as unknown as {
  student: { findFirst: ReturnType<typeof vi.fn> };
  feeStructure: { findMany: ReturnType<typeof vi.fn> };
  feePayment: { findMany: ReturnType<typeof vi.fn> };
};
const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const featureMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const rateMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;

const STUDENT_AUTH = { studentId: "stu-1", schoolId: "school-a" };
const STUDENT = {
  id: "stu-1",
  schoolId: "school-a",
  name: "Aarav",
  rollNo: "12",
  section: { id: "sec-1", classId: "class-1", name: "A", class: { id: "class-1", name: "8" } },
};
const FEE_STRUCTURE = {
  id: "fs-1",
  name: "Tuition",
  amount: "10000",
  frequency: "MONTHLY",
  classId: "class-1",
  class: { id: "class-1", name: "8" },
};
const PAYMENT = {
  id: "pay-1",
  amount: "5000",
  method: "CASH",
  paidAt: new Date("2026-01-01"),
  referenceNumber: null,
  receiptNumber: "R-1",
  status: "PAID",
  studentId: "stu-1",
  feeStructureId: "fs-1",
  createdAt: new Date("2026-01-01"),
  feeStructure: { name: "Tuition", amount: "10000" },
};

function req() {
  return new NextRequest("http://localhost/api/student/fees");
}

beforeEach(() => {
  vi.clearAllMocks();
  getStudentAuthMock.mockResolvedValue(STUDENT_AUTH);
  featureMock.mockResolvedValue(null);
  rateMock.mockResolvedValue(null);
  p.student.findFirst.mockResolvedValue(STUDENT);
  p.feeStructure.findMany.mockResolvedValue([FEE_STRUCTURE]);
  p.feePayment.findMany.mockResolvedValue([PAYMENT]);
});

describe("GET /api/student/fees", () => {
  it("a student can see their own fee accounts and payments", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feeAccounts).toHaveLength(1);
    expect(body.feeAccounts[0].student.id).toBe("stu-1");
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amount).toBe(5000);
  });

  it("scopes both queries by schoolId AND studentId — never a client-supplied id", async () => {
    await GET(req());
    expect(p.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "stu-1", schoolId: "school-a" } })
    );
    expect(p.feePayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-a", studentId: "stu-1" } })
    );
  });

  it("payment rows never include internal notes/recordedById fields", async () => {
    await GET(req());
    const selectArg = p.feePayment.findMany.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty("notes");
    expect(selectArg).not.toHaveProperty("recordedById");
  });

  it("unauthenticated request is denied", async () => {
    getStudentAuthMock.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(p.student.findFirst).not.toHaveBeenCalled();
  });

  it("FEES feature-flag denial is preserved", async () => {
    featureMock.mockResolvedValueOnce(NextResponse.json({ error: "Feature unavailable" }, { status: 403 }));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(p.student.findFirst).not.toHaveBeenCalled();
  });

  it("rate-limit denial (429) is preserved, keyed by STUDENT actorType", async () => {
    rateMock.mockResolvedValueOnce(NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 }));
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(rateMock).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: "school-a", actorType: "STUDENT", actorId: "stu-1" }),
      "STANDARD_READ"
    );
  });

  it("a different school's student is not found (cross-school isolation)", async () => {
    p.student.findFirst.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
  });
});
