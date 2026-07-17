import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateRequest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { createCertificateRequest, cancelCertificateRequest } from "@/lib/certificates/actions";

const p = prisma as unknown as {
  certificateRequest: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => vi.clearAllMocks());

describe("createCertificateRequest — duplicate active request prevention", () => {
  it("rejects when an active (PENDING/UNDER_REVIEW/APPROVED) duplicate already exists", async () => {
    p.certificateRequest.findFirst.mockResolvedValue({ id: "existing-1" });
    const result = await createCertificateRequest({
      schoolId: "s1",
      studentId: "stu1",
      certificateType: "BONAFIDE",
      customLabel: null,
      purpose: "Scholarship",
      requester: { type: "STUDENT" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(p.certificateRequest.create).not.toHaveBeenCalled();
  });

  it("allows creation when no active duplicate exists", async () => {
    p.certificateRequest.findFirst.mockResolvedValue(null);
    p.certificateRequest.create.mockResolvedValue({ id: "new-1", studentId: "stu1", certificateType: "BONAFIDE" });
    const result = await createCertificateRequest({
      schoolId: "s1",
      studentId: "stu1",
      certificateType: "BONAFIDE",
      customLabel: null,
      purpose: "Scholarship",
      requester: { type: "STUDENT" },
    });
    expect(result.ok).toBe(true);
    expect(p.certificateRequest.create).toHaveBeenCalledTimes(1);
  });

  it("also treats a DB-level unique-constraint violation (P2002) as the same 409 (belt-and-suspenders with the migration's partial unique index)", async () => {
    p.certificateRequest.findFirst.mockResolvedValue(null);
    p.certificateRequest.create.mockRejectedValue(Object.assign(new Error("unique violation"), { code: "P2002" }));
    const result = await createCertificateRequest({
      schoolId: "s1",
      studentId: "stu1",
      certificateType: "BONAFIDE",
      customLabel: null,
      purpose: "Scholarship",
      requester: { type: "STUDENT" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("never writes requesterUserId for a STUDENT requester (requester-integrity is enforced end to end)", async () => {
    p.certificateRequest.findFirst.mockResolvedValue(null);
    p.certificateRequest.create.mockResolvedValue({ id: "new-1" });
    await createCertificateRequest({
      schoolId: "s1",
      studentId: "stu1",
      certificateType: "BONAFIDE",
      customLabel: null,
      purpose: "Scholarship",
      requester: { type: "STUDENT" },
    });
    const call = p.certificateRequest.create.mock.calls[0][0];
    expect(call.data.requesterUserId).toBeNull();
    expect(call.data.requesterGuardianId).toBeNull();
    expect(call.data.requesterType).toBe("STUDENT");
  });
});

describe("cancelCertificateRequest", () => {
  it("is idempotent — cancelling an already-CANCELLED request is a no-op success", async () => {
    p.certificateRequest.findFirst.mockResolvedValue({ id: "r1", status: "CANCELLED", version: 2 });
    const result = await cancelCertificateRequest({ schoolId: "s1", requestId: "r1", expectedVersion: 2, actor: { kind: "REQUESTER", userId: "stu1" } });
    expect(result.ok).toBe(true);
    expect(p.certificateRequest.update).not.toHaveBeenCalled();
  });

  it("blocks a requester (student/guardian) from cancelling an APPROVED request", async () => {
    p.certificateRequest.findFirst.mockResolvedValue({ id: "r1", status: "APPROVED", version: 1 });
    const result = await cancelCertificateRequest({ schoolId: "s1", requestId: "r1", expectedVersion: 1, actor: { kind: "REQUESTER", userId: "stu1" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("allows STAFF to cancel an APPROVED request", async () => {
    p.certificateRequest.findFirst.mockResolvedValue({ id: "r1", status: "APPROVED", version: 1 });
    p.certificateRequest.update.mockResolvedValue({ id: "r1", status: "CANCELLED", version: 2 });
    const result = await cancelCertificateRequest({ schoolId: "s1", requestId: "r1", expectedVersion: 1, actor: { kind: "STAFF", userId: "u1" } });
    expect(result.ok).toBe(true);
  });

  it("never sets cancelledById for a REQUESTER-initiated cancel (no User row exists for students/guardians)", async () => {
    p.certificateRequest.findFirst.mockResolvedValue({ id: "r1", status: "PENDING", version: 0 });
    p.certificateRequest.update.mockResolvedValue({ id: "r1", status: "CANCELLED", version: 1 });
    await cancelCertificateRequest({ schoolId: "s1", requestId: "r1", expectedVersion: 0, actor: { kind: "REQUESTER", userId: "stu1" } });
    const call = p.certificateRequest.update.mock.calls[0][0];
    expect(call.data.cancelledById).toBeNull();
  });

  it("rejects on a stale version (optimistic concurrency)", async () => {
    p.certificateRequest.findFirst.mockResolvedValue({ id: "r1", status: "PENDING", version: 3 });
    const result = await cancelCertificateRequest({ schoolId: "s1", requestId: "r1", expectedVersion: 1, actor: { kind: "REQUESTER", userId: "stu1" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});
