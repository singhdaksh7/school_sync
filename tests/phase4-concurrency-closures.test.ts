import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backgroundJob: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    authLoginEvent: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    authSession: { count: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { createJob } from "@/lib/jobs";
import { checkLoginQuota, recordLoginEvent } from "@/lib/auth-login-quota";
import { createSession, countActiveSessions } from "@/lib/auth-sessions";
import { withActorLoginLock } from "@/lib/auth-concurrency";

const p = prisma as unknown as {
  backgroundJob: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  authLoginEvent: { count: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  authSession: { count: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

// ── PART 11: job dedup concurrency ────────────────────────────────────────────
describe("createJob — P2002 race fallback (PART 11)", () => {
  it("on a clean create, returns the new job with no deduplicated flag", async () => {
    p.backgroundJob.create.mockResolvedValue({ id: "job1", status: "PENDING", totalItems: 3 });
    const result = await createJob({ type: "SMART_TIMETABLE_GENERATION", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", sections: [{ classId: "c1", sectionId: "sec1" }] }, totalItems: 1, payloadFingerprint: "fp1" });
    expect(result).toMatchObject({ ok: true, job: { id: "job1" } });
    expect(result.ok && result.deduplicated).toBeFalsy();
  });

  it("when create hits a unique-constraint violation (concurrent duplicate), returns the existing active job instead of failing", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    p.backgroundJob.create.mockRejectedValue(p2002);
    p.backgroundJob.findFirst.mockResolvedValue({ id: "job-winner", status: "RUNNING", totalItems: 5 });

    const result = await createJob({ type: "REPORT_CARD_BATCH_GENERATION", schoolId: "s1", payload: { schoolId: "s1", teacherId: "t1", sectionId: "sec1", examSchemeId: "ex1", studentIds: ["a", "b"] }, totalItems: 2, payloadFingerprint: "fp1" });

    expect(result).toMatchObject({ ok: true, deduplicated: true, job: { id: "job-winner" } });
    expect(p.backgroundJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ payloadFingerprint: "fp1", status: { in: ["PENDING", "RUNNING"] } }) })
    );
  });

  it("re-throws a P2002 with no payloadFingerprint context (not a dedup collision)", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    p.backgroundJob.create.mockRejectedValue(p2002);
    await expect(
      createJob({ type: "STUDENT_BULK_IMPORT", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", storedFileId: "f1", rowCount: 10 }, totalItems: 10 })
    ).rejects.toThrow();
  });

  it("re-throws a non-P2002 error unchanged", async () => {
    p.backgroundJob.create.mockRejectedValue(new Error("connection lost"));
    await expect(
      createJob({ type: "SMART_TIMETABLE_GENERATION", schoolId: "s1", payload: { schoolId: "s1", createdById: "u1", sections: [{ classId: "c1", sectionId: "sec1" }] }, totalItems: 1, payloadFingerprint: "fp1" })
    ).rejects.toThrow("connection lost");
  });
});

// ── PART 12: login quota + active session concurrency ────────────────────────
describe("withActorLoginLock (PART 12)", () => {
  it("wraps the callback in prisma.$transaction and issues the advisory-lock SQL first", async () => {
    let executedRawCalled = false;
    const txClient = { $executeRaw: vi.fn(async () => { executedRawCalled = true; }) };
    p.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(txClient));

    const actor = { schoolId: "s1", actorType: "PARENT", guardianId: "g1" };
    const result = await withActorLoginLock(actor, async () => {
      if (!executedRawCalled) throw new Error("lock was not acquired before the callback ran");
      return "done";
    });

    expect(result).toBe("done");
    expect(txClient.$executeRaw).toHaveBeenCalled();
  });
});

describe("checkLoginQuota / recordLoginEvent accept an injected db client (PART 12)", () => {
  it("uses the provided client instead of the global prisma singleton", async () => {
    const txCount = vi.fn().mockResolvedValue(0);
    const tx = { authLoginEvent: { count: txCount, findFirst: vi.fn(), create: vi.fn() } };
    const result = await checkLoginQuota({ schoolId: "s1", actorType: "PARENT", guardianId: "g1" }, new Date(), tx as never);
    expect(result.allowed).toBe(true);
    expect(txCount).toHaveBeenCalled();
    expect(p.authLoginEvent.count).not.toHaveBeenCalled();
  });

  it("recordLoginEvent inserts via the provided client", async () => {
    const txCreate = vi.fn().mockResolvedValue({});
    const tx = { authLoginEvent: { create: txCreate } };
    await recordLoginEvent({ schoolId: "s1", actorType: "PARENT", guardianId: "g1" }, new Date(), null, tx as never);
    expect(txCreate).toHaveBeenCalled();
    expect(p.authLoginEvent.create).not.toHaveBeenCalled();
  });
});

describe("createSession / countActiveSessions accept an injected db client (PART 12)", () => {
  it("uses the provided client for the count-evict-create sequence", async () => {
    const tx = {
      authSession: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "sess1" }),
      },
    };
    const result = await createSession({ schoolId: "s1", actorType: "PARENT", guardianId: "g1" }, {}, new Date(), tx as never);
    expect(result.session).toMatchObject({ id: "sess1" });
    expect(tx.authSession.create).toHaveBeenCalled();
    expect(p.authSession.create).not.toHaveBeenCalled();
  });

  it("countActiveSessions with an injected client never touches the global prisma", async () => {
    const tx = { authSession: { count: vi.fn().mockResolvedValue(2) } };
    const count = await countActiveSessions({ schoolId: "s1", actorType: "STUDENT", studentId: "st1" }, new Date(), tx as never);
    expect(count).toBe(2);
    expect(p.authSession.count).not.toHaveBeenCalled();
  });
});
