import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolInvite: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: vi.fn() }));
vi.mock("@/lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs")>();
  return { ...actual, claimSpecificJob: vi.fn(), completeJob: vi.fn(), failJob: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { sendStaffInviteEmail } from "@/lib/email";
import { claimSpecificJob, completeJob, failJob } from "@/lib/jobs";
import { getJobHandler, runInviteEmailDeliveryInline } from "@/lib/job-handlers";

const p = prisma as unknown as {
  schoolInvite: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const baseInvite = {
  id: "invite1",
  name: "Jane Doe",
  email: "jane@school.edu",
  role: "SCHOOL_ADMIN",
  usedAt: null,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  school: { name: "Greenwood High" },
};

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but not implementations set via
  // mockResolvedValue/mockRejectedValue in a previous test — re-establish
  // the default "send succeeds" behavior explicitly every time.
  vi.mocked(sendStaffInviteEmail).mockResolvedValue(undefined as never);
});

describe("INVITE_EMAIL_DELIVERY handler (poller path — job already claimed/RUNNING)", () => {
  const handler = getJobHandler("INVITE_EMAIL_DELIVERY")!;
  const job = { id: "job1", type: "INVITE_EMAIL_DELIVERY", payload: { inviteId: "invite1" } } as never;
  const helpers = { updateProgress: vi.fn(async () => {}) };

  it("mints a fresh token, persists only its hash, sends the email, and never returns the raw token in resultMetadata", async () => {
    p.schoolInvite.findUnique.mockResolvedValue(baseInvite);
    p.schoolInvite.update.mockResolvedValue({ ...baseInvite, tokenHash: "hash" });

    const result = await handler(job, helpers);

    expect(sendStaffInviteEmail).toHaveBeenCalledWith(
      "jane@school.edu",
      expect.objectContaining({ inviteLink: expect.stringContaining("/invite/") })
    );
    expect(p.schoolInvite.update).toHaveBeenCalledWith({ where: { id: "invite1" }, data: { tokenHash: expect.any(String) } });
    expect(result.resultMetadata).not.toHaveProperty("rawToken");
    expect(JSON.stringify(result.resultMetadata)).not.toMatch(/invite\//); // no link/token leaked into persisted metadata
    expect(result.processedItems).toBe(1);
  });

  it("is a safe no-op (does not email) when the invite was already accepted", async () => {
    p.schoolInvite.findUnique.mockResolvedValue({ ...baseInvite, usedAt: new Date() });
    const result = await handler(job, helpers);
    expect(sendStaffInviteEmail).not.toHaveBeenCalled();
    expect(result.resultMetadata).toMatchObject({ delivered: false, reason: "invite already accepted" });
  });

  it("is a safe no-op when the invite expired before delivery ran", async () => {
    p.schoolInvite.findUnique.mockResolvedValue({ ...baseInvite, expiresAt: new Date(Date.now() - 1000) });
    const result = await handler(job, helpers);
    expect(sendStaffInviteEmail).not.toHaveBeenCalled();
    expect(result.resultMetadata).toMatchObject({ delivered: false, reason: "invite expired" });
  });

  it("is a safe no-op when the invite is gone (e.g. the school was cancelled/purged first)", async () => {
    p.schoolInvite.findUnique.mockResolvedValue(null);
    const result = await handler(job, helpers);
    expect(sendStaffInviteEmail).not.toHaveBeenCalled();
    expect(result.resultMetadata.delivered).toBe(false);
  });
});

describe("runInviteEmailDeliveryInline (route's same-request fast path)", () => {
  it("claims the specific job, delivers, completes it, and hands the raw token back to the caller only — never persisted", async () => {
    vi.mocked(claimSpecificJob).mockResolvedValue({ id: "job1", claimToken: "tok1", payload: { inviteId: "invite1" } } as never);
    p.schoolInvite.findUnique.mockResolvedValue(baseInvite);
    p.schoolInvite.update.mockResolvedValue({ ...baseInvite, tokenHash: "hash" });

    const result = await runInviteEmailDeliveryInline("job1");

    expect(result.status).toBe("COMPLETED");
    expect(result.rawToken).toBeTruthy();
    expect(completeJob).toHaveBeenCalledWith(
      "job1",
      "tok1",
      expect.objectContaining({ inviteId: "invite1", delivered: true })
    );
    // The completion record passed to the durable job row never contains the token.
    const completeArgs = vi.mocked(completeJob).mock.calls[0];
    expect(JSON.stringify(completeArgs[2])).not.toContain(result.rawToken);
  });

  it("returns SKIPPED (no error) when another runner already owns the job — e.g. the standalone worker won the race after a crash", async () => {
    vi.mocked(claimSpecificJob).mockResolvedValue(null);
    const result = await runInviteEmailDeliveryInline("job1");
    expect(result.status).toBe("SKIPPED");
    expect(sendStaffInviteEmail).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).not.toHaveBeenCalled();
  });

  it("fails the job with a sanitized error (no token/link) when the email provider throws", async () => {
    vi.mocked(claimSpecificJob).mockResolvedValue({ id: "job1", claimToken: "tok1", payload: { inviteId: "invite1" } } as never);
    p.schoolInvite.findUnique.mockResolvedValue(baseInvite);
    p.schoolInvite.update.mockResolvedValue({ ...baseInvite, tokenHash: "hash" });
    vi.mocked(sendStaffInviteEmail).mockRejectedValue(new Error("SES throttled"));

    const result = await runInviteEmailDeliveryInline("job1");

    expect(result.status).toBe("FAILED");
    expect(failJob).toHaveBeenCalledWith("job1", "tok1", expect.stringContaining("SES throttled"));
    const failArgs = vi.mocked(failJob).mock.calls[0];
    expect(failArgs[2]).not.toMatch(/invite\//); // never leaks the link/token into the stored error summary
  });
});

describe("crash-after-commit regression proof (paired with tests/school-onboarding.test.ts)", () => {
  it("a durable PENDING job created by the onboarding transaction is fully processable by the worker path with no other state required", async () => {
    // This models exactly the state left behind by a process crash that
    // happens after src/lib/school-onboarding.ts's transaction commits but
    // before runInviteEmailDeliveryInline ever runs: a SchoolInvite row with
    // tokenHash still null, and nothing else. tests/school-onboarding.test.ts
    // proves the transaction always produces this row pair atomically; this
    // test proves that row pair alone is sufficient for the worker
    // (getJobHandler) to complete delivery later, with no in-memory state
    // carried over from the crashed process.
    const survivedInvite = { ...baseInvite, tokenHash: null };
    p.schoolInvite.findUnique.mockResolvedValue(survivedInvite);
    p.schoolInvite.update.mockResolvedValue({ ...survivedInvite, tokenHash: "hash" });

    const handler = getJobHandler("INVITE_EMAIL_DELIVERY")!;
    const survivedJob = { id: "job1", type: "INVITE_EMAIL_DELIVERY", payload: { inviteId: "invite1" } } as never;
    const result = await handler(survivedJob, { updateProgress: vi.fn(async () => {}) });

    expect(sendStaffInviteEmail).toHaveBeenCalledTimes(1);
    expect(result.resultMetadata).toMatchObject({ delivered: true });
  });
});
