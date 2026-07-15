import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findFirst: vi.fn(), findMany: vi.fn() },
    feeStructure: { findFirst: vi.fn(), findMany: vi.fn() },
    feePayment: { aggregate: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    subscriptionPlan: { findMany: vi.fn() },
    paymentProofSubmission: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/founder", () => ({ requireFounderSession: vi.fn() }));
vi.mock("@/lib/revenue", () => ({ getRevenueSummary: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  canWriteSchool: vi.fn(),
  canAccessSchoolForBilling: vi.fn(),
  sessionRole: vi.fn(),
}));
vi.mock("@/lib/teacher-authorization", () => ({ requireSchoolAccess: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ requireSchoolFeature: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/parent-auth", () => ({
  getAuthenticatedGuardian: vi.fn(),
  guardianCanAccessStudent: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireFounderSession } from "@/lib/founder";
import { getRevenueSummary } from "@/lib/revenue";
import { canWriteSchool, canAccessSchoolForBilling, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import * as parentFeesRoute from "@/app/api/parent/fees/route";
import { POST as createOrderPost } from "@/app/api/parent/fees/create-order/route";
import { POST as recordFeePaymentPost } from "@/app/api/schools/[schoolId]/fee-payments/route";
import { GET as founderPlansGet } from "@/app/api/founder/plans/route";
import { GET as founderPaymentProofsGet } from "@/app/api/founder/payment-proofs/route";
import { GET as founderRevenueGet } from "@/app/api/founder/revenue/route";
import { GET as schoolPaymentProofsGet } from "@/app/api/schools/[schoolId]/payment-proofs/route";

const p = prisma as unknown as {
  student: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  feeStructure: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  feePayment: {
    aggregate: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  subscriptionPlan: { findMany: ReturnType<typeof vi.fn> };
  paymentProofSubmission: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const requireFounderSessionMock = requireFounderSession as unknown as ReturnType<typeof vi.fn>;
const getRevenueSummaryMock = getRevenueSummary as unknown as ReturnType<typeof vi.fn>;
const canWriteSchoolMock = canWriteSchool as unknown as ReturnType<typeof vi.fn>;
const canAccessSchoolForBillingMock = canAccessSchoolForBilling as unknown as ReturnType<typeof vi.fn>;
const sessionRoleMock = sessionRole as unknown as ReturnType<typeof vi.fn>;
const requireSchoolAccessMock = requireSchoolAccess as unknown as ReturnType<typeof vi.fn>;
const requireSchoolFeatureMock = requireSchoolFeature as unknown as ReturnType<typeof vi.fn>;
const getAuthenticatedGuardianMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;

function postJsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validManualPaymentBody = {
  studentId: "stu1",
  feeStructureId: "fee1",
  amount: 10000,
  method: "UPI",
  paidAt: "2026-07-04",
  referenceNumber: "UPI-ABC123",
  remarks: "July payment",
};

beforeEach(() => {
  vi.clearAllMocks();

  authMock.mockResolvedValue({ user: { id: "u1", role: "SCHOOL_ADMIN" } });
  requireFounderSessionMock.mockResolvedValue({ user: { id: "founder1" } });
  getRevenueSummaryMock.mockResolvedValue({
    monthlyRevenue: 0,
    annualRevenue: 0,
    activeSubscriptions: 0,
    trialSchools: 0,
    expiredSchools: 0,
    suspendedSchools: 0,
    revenueByPlan: [],
  });

  canWriteSchoolMock.mockResolvedValue(true);
  canAccessSchoolForBillingMock.mockResolvedValue(true);
  sessionRoleMock.mockImplementation((user: { role?: string }) => user?.role);
  requireSchoolAccessMock.mockResolvedValue({ ok: true, teacherId: null });
  requireSchoolFeatureMock.mockResolvedValue(null);

  getAuthenticatedGuardianMock.mockResolvedValue({
    guardian: { id: "g1", schoolId: "s1" },
  });

  p.student.findFirst.mockResolvedValue({ id: "stu1", section: { classId: "class1" } });
  p.feeStructure.findFirst.mockResolvedValue({ id: "fee1", amount: { toString: () => "50000" }, classId: "class1" });
  p.feePayment.aggregate.mockResolvedValue({ _sum: { amount: { toString: () => "0" } } });
  p.feePayment.create.mockResolvedValue({ id: "pay1", receiptNumber: null });
  p.feePayment.update.mockResolvedValue({
    id: "pay1",
    amount: { toString: () => "10000" },
    method: "UPI",
    referenceNumber: "UPI-ABC123",
    notes: "July payment",
    receiptNumber: "SS-20260704-00000001",
    status: "PAID",
    student: { name: "Aarav Sharma", rollNo: "12", section: { name: "A", class: { name: "10" } } },
    feeStructure: { name: "Annual Fee", amount: { toString: () => "50000" } },
    recordedBy: { name: "Admin" },
  });

  p.subscriptionPlan.findMany.mockResolvedValue([]);
  p.paymentProofSubmission.findMany.mockResolvedValue([]);
  p.paymentProofSubmission.count.mockResolvedValue(0);
});

describe("student fee recording tenant validation", () => {
  it("student school ownership is validated", async () => {
    p.student.findFirst.mockResolvedValueOnce(null);

    const res = await recordFeePaymentPost(postJsonRequest("http://localhost/api/schools/s1/fee-payments", validManualPaymentBody), {
      params: Promise.resolve({ schoolId: "s1" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Student not found in this school");
  });

  it("fee structure school ownership is validated", async () => {
    p.feeStructure.findFirst.mockResolvedValueOnce(null);

    const res = await recordFeePaymentPost(postJsonRequest("http://localhost/api/schools/s1/fee-payments", validManualPaymentBody), {
      params: Promise.resolve({ schoolId: "s1" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Fee structure not found in this school");
  });

  it("cross-tenant recording is denied", async () => {
    canWriteSchoolMock.mockResolvedValueOnce(false);
    sessionRoleMock.mockReturnValueOnce("SCHOOL_ADMIN");

    const res = await recordFeePaymentPost(postJsonRequest("http://localhost/api/schools/s1/fee-payments", validManualPaymentBody), {
      params: Promise.resolve({ schoolId: "s1" }),
    });

    expect(res.status).toBe(403);
  });
});

describe("student fee parent access and retired online flow", () => {
  it("parent student-fee endpoint is read-only", () => {
    expect((parentFeesRoute as { POST?: unknown }).POST).toBeUndefined();
  });

  it("parent online student-fee payment creation is unavailable", async () => {
    const res = await createOrderPost();
    expect(res.status).toBe(410);
  });
});

describe("feature-flag separation", () => {
  it("FEES=false blocks student-fee admin routes", async () => {
    requireSchoolFeatureMock.mockResolvedValueOnce(NextResponse.json({ error: "Fees disabled" }, { status: 403 }));

    const res = await recordFeePaymentPost(postJsonRequest("http://localhost/api/schools/s1/fee-payments", validManualPaymentBody), {
      params: Promise.resolve({ schoolId: "s1" }),
    });

    expect(res.status).toBe(403);
    expect(p.student.findFirst).not.toHaveBeenCalled();
  });

  it("FEES=false blocks parent student-fee read", async () => {
    requireSchoolFeatureMock.mockResolvedValueOnce(NextResponse.json({ error: "Fees disabled" }, { status: 403 }));

    const req = new Request("http://localhost/api/parent/fees", {
      headers: { Authorization: "Bearer token" },
    }) as unknown as Parameters<typeof parentFeesRoute.GET>[0];
    const res = await parentFeesRoute.GET(req);

    expect(res.status).toBe(403);
    expect(p.student.findMany).not.toHaveBeenCalled();
  });
});

describe("SaaS billing routes remain unaffected", () => {
  it("Founder plans remain accessible", async () => {
    const res = await founderPlansGet(new Request("http://localhost/api/founder/plans"));
    expect(res.status).toBe(200);
    expect((await res.json()).plans).toEqual([]);
  });

  it("Founder payment-proof and revenue routes remain accessible", async () => {
    const proofsRes = await founderPaymentProofsGet(new Request("http://localhost/api/founder/payment-proofs"));
    const revenueRes = await founderRevenueGet();

    expect(proofsRes.status).toBe(200);
    expect(revenueRes.status).toBe(200);
  });

  it("school billing payment-proof recovery route remains FEES-exempt", async () => {
    requireSchoolFeatureMock.mockResolvedValueOnce(NextResponse.json({ error: "Fees disabled" }, { status: 403 }));
    canAccessSchoolForBillingMock.mockResolvedValueOnce(true);

    const res = await schoolPaymentProofsGet(new Request("http://localhost/api/schools/s1/payment-proofs"), {
      params: Promise.resolve({ schoolId: "s1" }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).submissions).toEqual([]);
  });
});
