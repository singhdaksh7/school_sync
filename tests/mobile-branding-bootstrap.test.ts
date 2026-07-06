import { beforeEach, describe, expect, it, vi } from "vitest";

// school-resolver itself (resolveTenantBrandingForSchoolId / brandingForSchool)
// is REAL here — this test proves the mobile bootstrap route reuses the exact
// canonical WHITE_LABEL resolver, not a second branding implementation.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/mobile-auth", () => ({ getMobileAuth: vi.fn() }));
vi.mock("@/lib/parent-auth", () => ({ getAuthenticatedGuardian: vi.fn() }));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));

import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getMobileAuth } from "@/lib/mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { GET as brandingGet } from "@/app/api/mobile/branding/route";

const p = prisma as unknown as { school: { findUnique: ReturnType<typeof vi.fn> } };
const isFeatureEnabledMock = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;
const getMobileAuthMock = getMobileAuth as unknown as ReturnType<typeof vi.fn>;
const getAuthenticatedGuardianMock = getAuthenticatedGuardian as unknown as ReturnType<typeof vi.fn>;

const SCHOOLS: Record<string, unknown> = {
  "school-a": {
    id: "school-a",
    name: "Green Valley School",
    slug: "green-valley",
    customDomain: null,
    logoUrl: "https://cdn.example.com/a-logo.png",
    logoFile: null,
    primaryColor: "#123456",
    secondaryColor: "#654321",
    appName: "Green Valley ERP",
    poweredBySchoolSync: false,
  },
  "school-b": {
    id: "school-b",
    name: "Riverside Academy",
    slug: "riverside",
    customDomain: null,
    logoUrl: "https://cdn.example.com/b-logo.png",
    logoFile: null,
    primaryColor: "#abcdef",
    secondaryColor: "#fedcba",
    appName: "Riverside Portal",
    poweredBySchoolSync: false,
  },
};

// No "host"/"x-forwarded-host" header anywhere below — proving the route
// never depends on request hostname, unlike the public /api/branding route.
function req(url = "http://localhost/api/mobile/branding") {
  return new Request(url, { headers: { Authorization: "Bearer token" } }) as unknown as Parameters<typeof brandingGet>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  p.school.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => SCHOOLS[where.id] ?? null);
  isFeatureEnabledMock.mockResolvedValue(true);
});

describe("GET /api/mobile/branding — unauthenticated", () => {
  it("denies a request with no valid mobile or parent session", async () => {
    getMobileAuthMock.mockResolvedValue(null);
    getAuthenticatedGuardianMock.mockResolvedValue(null);

    const res = await brandingGet(req());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mobile/branding — actor coverage, no hostname dependence", () => {
  it("resolves Parent branding from the bearer session's school", async () => {
    getMobileAuthMock.mockResolvedValue(null);
    getAuthenticatedGuardianMock.mockResolvedValue({ guardian: { id: "g1", schoolId: "school-a" } });

    const res = await brandingGet(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schoolName).toBe("Green Valley School");
    expect(body.appName).toBe("Green Valley ERP");
  });

  it("resolves Student branding from the bearer session's school", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "STUDENT", schoolId: "school-b", studentId: "stu1" } });

    const res = await brandingGet(req());
    const body = await res.json();
    expect(body.schoolName).toBe("Riverside Academy");
  });

  it("resolves Teacher branding from the bearer session's school — correct branding on a shared API hostname (no host header sent)", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" } });

    const res = await brandingGet(req());
    const body = await res.json();
    expect(body.schoolName).toBe("Green Valley School");
    expect(body.primaryColor).toBe("#123456");
  });
});

describe("GET /api/mobile/branding — WHITE_LABEL semantics (canonical resolver)", () => {
  it("falls back to safe co-branded defaults when WHITE_LABEL is disabled, even though branding is saved", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" } });
    isFeatureEnabledMock.mockResolvedValueOnce(false);

    const res = await brandingGet(req());
    const body = await res.json();
    expect(body.schoolName).toBe("Green Valley School"); // real identity still shown
    expect(body.appName).toBe("Green Valley School"); // custom appName suppressed
    expect(body.logoUrl).toBeNull();
    expect(body.poweredBySchoolSync).toBe(true); // attribution forced on
  });

  it("returns the saved premium branding when WHITE_LABEL is re-enabled", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" } });
    isFeatureEnabledMock.mockResolvedValueOnce(true);

    const res = await brandingGet(req());
    const body = await res.json();
    expect(body.appName).toBe("Green Valley ERP");
    expect(body.logoUrl).toBe("https://cdn.example.com/a-logo.png");
    expect(body.poweredBySchoolSync).toBe(false);
  });

  it("poweredBySchoolSync comes from the canonical resolver's saved value, not a hardcoded default", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" } });
    isFeatureEnabledMock.mockResolvedValueOnce(true);
    p.school.findUnique.mockResolvedValueOnce({ ...(SCHOOLS["school-a"] as object), poweredBySchoolSync: true });

    const res = await brandingGet(req());
    expect((await res.json()).poweredBySchoolSync).toBe(true);
  });
});

describe("GET /api/mobile/branding — tenant isolation", () => {
  it("a School A session cannot request School B's branding, even via a query param", async () => {
    getMobileAuthMock.mockResolvedValue({ decoded: { role: "TEACHER", schoolId: "school-a", teacherId: "t1", userId: "u1" } });

    const res = await brandingGet(req("http://localhost/api/mobile/branding?schoolId=school-b"));
    const body = await res.json();
    expect(body.schoolName).toBe("Green Valley School"); // still school-a, query param ignored
    expect(p.school.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "school-a" } }));
  });
});
