import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolFeatureFlag: { findUnique: vi.fn() },
    schoolSubscription: { findUnique: vi.fn() },
    student: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getStudentLimitInfo, withinStudentLimit } from "@/lib/plan-limits";

const p = prisma as unknown as {
  schoolFeatureFlag: { findUnique: ReturnType<typeof vi.fn> };
  schoolSubscription: { findUnique: ReturnType<typeof vi.fn> };
  student: { count: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("requireSchoolFeature — server-side module gate (B1)", () => {
  it("returns a 403 when the module is disabled", async () => {
    p.schoolFeatureFlag.findUnique.mockResolvedValue({ enabled: false });
    const res = await requireSchoolFeature("s1", "FEES");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("returns null (continue) when the module is enabled", async () => {
    p.schoolFeatureFlag.findUnique.mockResolvedValue({ enabled: true });
    expect(await requireSchoolFeature("s1", "FEES")).toBeNull();
  });

  it("defaults to enabled when no flag row exists (absence = on)", async () => {
    p.schoolFeatureFlag.findUnique.mockResolvedValue(null);
    expect(await requireSchoolFeature("s1", "REPORT_CARDS")).toBeNull();
  });
});

describe("student plan-limit enforcement (B2)", () => {
  it("rejects creation once the current count reaches the plan cap", async () => {
    p.schoolSubscription.findUnique.mockResolvedValue({ plan: { maxStudents: 200 } });
    p.student.count.mockResolvedValue(200);
    const { maxStudents, currentCount } = await getStudentLimitInfo("s1");
    expect(withinStudentLimit(currentCount, 1, maxStudents)).toBe(false);
  });

  it("permits creation below the cap", async () => {
    p.schoolSubscription.findUnique.mockResolvedValue({ plan: { maxStudents: 200 } });
    p.student.count.mockResolvedValue(150);
    const { maxStudents, currentCount } = await getStudentLimitInfo("s1");
    expect(withinStudentLimit(currentCount, 1, maxStudents)).toBe(true);
  });

  it("treats a school with no subscription as unlimited", async () => {
    p.schoolSubscription.findUnique.mockResolvedValue(null);
    p.student.count.mockResolvedValue(99_999);
    const { maxStudents, currentCount } = await getStudentLimitInfo("s1");
    expect(withinStudentLimit(currentCount, 1, maxStudents)).toBe(true);
  });
});
