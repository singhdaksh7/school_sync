import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    feePayment: { findFirst: vi.fn(), aggregate: vi.fn() },
  },
}));
vi.mock("@/lib/student-mobile-auth", () => ({ getStudentAuth: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn(async () => null) }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/receipt-pdf", () => ({ generateReceiptPdf: vi.fn(() => Buffer.from("pdf-bytes")) }));

import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { generateReceiptPdf } from "@/lib/receipt-pdf";
import { GET } from "@/app/api/student/fees/[paymentId]/receipt/route";

const p = prisma as unknown as {
  feePayment: { findFirst: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> };
};
const getStudentAuthMock = getStudentAuth as unknown as ReturnType<typeof vi.fn>;
const featureMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const rateMock = enforceActorRateLimit as unknown as ReturnType<typeof vi.fn>;
const generatePdfMock = generateReceiptPdf as unknown as ReturnType<typeof vi.fn>;

const STUDENT_AUTH = { studentId: "stu-1", schoolId: "school-a" };
const PAYMENT = {
  id: "pay-1",
  schoolId: "school-a",
  studentId: "stu-1",
  feeStructureId: "fs-1",
  amount: "5000",
  method: "CASH",
  paymentGateway: null,
  gatewayPaymentId: null,
  referenceNumber: null,
  receiptNumber: "R-1",
  status: "PAID",
  paidAt: new Date("2026-01-01"),
  notes: "internal remark should never leak",
  school: { name: "Test School", logoUrl: null },
  student: { id: "stu-1", name: "Aarav", admissionNo: "A1", section: { name: "A", class: { name: "8" } } },
  feeStructure: { name: "Tuition", amount: "10000" },
};

function req() {
  return new NextRequest("http://localhost/api/student/fees/pay-1/receipt");
}

beforeEach(() => {
  vi.clearAllMocks();
  getStudentAuthMock.mockResolvedValue(STUDENT_AUTH);
  featureMock.mockResolvedValue(null);
  rateMock.mockResolvedValue(null);
  generatePdfMock.mockReturnValue(Buffer.from("pdf-bytes"));
  p.feePayment.findFirst.mockResolvedValue(PAYMENT);
  p.feePayment.aggregate.mockResolvedValue({ _sum: { amount: "5000" } });
});

describe("GET /api/student/fees/[paymentId]/receipt", () => {
  it("a student can download their own paid receipt", async () => {
    const res = await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("scopes the lookup by schoolId AND studentId — never a client-supplied id", async () => {
    await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(p.feePayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay-1", schoolId: "school-a", studentId: "stu-1", status: "PAID" } })
    );
  });

  it("internal notes are never passed into the generated PDF", async () => {
    await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(generatePdfMock).toHaveBeenCalledWith(expect.objectContaining({ remarks: null }));
  });

  it("a payment belonging to another student is not found", async () => {
    p.feePayment.findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(res.status).toBe(404);
    expect(generatePdfMock).not.toHaveBeenCalled();
  });

  it("a PENDING/unpaid payment id is not found (status: PAID is baked into the query)", async () => {
    await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(p.feePayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PAID" }) })
    );
  });

  it("unauthenticated request is denied", async () => {
    getStudentAuthMock.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(res.status).toBe(401);
    expect(p.feePayment.findFirst).not.toHaveBeenCalled();
  });

  it("FEES feature-flag denial is preserved", async () => {
    featureMock.mockResolvedValueOnce(NextResponse.json({ error: "Feature unavailable" }, { status: 403 }));
    const res = await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(res.status).toBe(403);
    expect(p.feePayment.findFirst).not.toHaveBeenCalled();
  });

  it("PDF Cost Guard denial (429) is preserved, keyed by STUDENT actorType", async () => {
    rateMock.mockResolvedValueOnce(NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 }));
    const res = await GET(req(), { params: Promise.resolve({ paymentId: "pay-1" }) });
    expect(res.status).toBe(429);
    expect(rateMock).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: "school-a", actorType: "STUDENT", actorId: "stu-1" }),
      "PDF"
    );
  });
});
