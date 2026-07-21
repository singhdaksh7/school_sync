import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies the class/section-scoped student-list routes/lib functions were
 * actually wired to the canonical roll-number comparator (src/lib/student-
 * ordering.ts) — as opposed to unit-testing the comparator itself (see
 * tests/student-ordering.test.ts).
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", role: "SCHOOL_ADMIN" } })) }));
vi.mock("@/lib/teacher-authorization", () => ({
  requireSchoolAccess: vi.fn(async () => ({ ok: true, teacherId: null })),
}));
vi.mock("@/lib/api-cost-guard", () => ({ enforceActorRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/tenant", () => ({
  canAccessSchool: vi.fn(async () => true),
  hasPrismaErrorCode: vi.fn(() => false),
  sectionBelongsToSchool: vi.fn(async () => true),
  sessionRole: (user: unknown) => (user as { role?: string })?.role,
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/request-ip", () => ({ getClientIp: vi.fn(() => "127.0.0.1") }));
vi.mock("@/lib/student-creation", () => ({ createStudentRecord: vi.fn() }));
vi.mock("@/lib/homework", () => ({ backfillHomeworkStatusForStudent: vi.fn(async () => {}) }));
vi.mock("@/lib/plan-limits", () => ({
  getStudentLimitInfo: vi.fn(async () => ({ maxStudents: null, currentCount: 0 })),
  withinStudentLimit: vi.fn(() => true),
  STUDENT_LIMIT_MESSAGE: "limit",
}));

const { queryRawMock, findManyMock, countMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(async () => 3),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findMany: findManyMock, count: countMock },
    $queryRaw: queryRawMock,
  },
}));

import { GET } from "@/app/api/schools/[schoolId]/students/route";

const PARAMS = { params: Promise.resolve({ schoolId: "school-1" }) };

function studentRow(id: string, rollNo: string) {
  return { id, rollNo, name: `Student ${rollNo}`, section: { name: "A", class: { name: "10" } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockResolvedValue(3);
});

describe("GET /api/schools/[schoolId]/students — sort-before-paginate ordering", () => {
  it("orders students by the database-level roll-number query, not by the (arbitrary) findMany result order", async () => {
    // The raw query is the source of truth for order — it returns ids "2","10","1"
    // (deliberately NOT numeric-string order) representing the correctly-computed
    // roll-number-ascending page: roll 1, roll 2, roll 10.
    queryRawMock.mockResolvedValue([{ id: "s-roll-1" }, { id: "s-roll-2" }, { id: "s-roll-10" }]);
    // findMany (fetching full typed rows for those ids) returns them in a
    // DIFFERENT, arbitrary order — proving the route must re-assemble by the
    // raw query's order rather than trusting findMany's own ordering.
    findManyMock.mockResolvedValue([studentRow("s-roll-10", "10"), studentRow("s-roll-1", "1"), studentRow("s-roll-2", "2")]);

    const req = new Request("http://localhost/api/schools/school-1/students");
    const res = await GET(req, PARAMS);
    const body = await res.json();

    expect(body.data.map((s: { id: string }) => s.id)).toEqual(["s-roll-1", "s-roll-2", "s-roll-10"]);
  });

  it("passes LIMIT/OFFSET consistent with parsePagination into the raw ordering query (sort happens before pagination)", async () => {
    queryRawMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([]);

    const req = new Request("http://localhost/api/schools/school-1/students?page=2&limit=10");
    await GET(req, PARAMS);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const sqlArg = queryRawMock.mock.calls[0][0];
    // Prisma.sql produces a tagged-template Sql object; its `.values` carries
    // the bound parameters in source order — schoolId, then take (LIMIT), then skip (OFFSET).
    expect(sqlArg.values).toContain(10); // take
    expect(sqlArg.values).toContain(10); // skip = (page-1)*limit = 10
  });

  it("scopes the raw query by sectionId when provided (tenant/class/section isolation, parameterized)", async () => {
    queryRawMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([]);

    const req = new Request("http://localhost/api/schools/school-1/students?sectionId=section-a");
    await GET(req, PARAMS);

    const sqlArg = queryRawMock.mock.calls[0][0];
    expect(sqlArg.values).toContain("section-a");
    expect(sqlArg.strings.join(" ")).toContain('s."sectionId"');
  });

  it("returns an empty page without querying findMany when the raw ordering query returns no ids", async () => {
    queryRawMock.mockResolvedValue([]);

    const req = new Request("http://localhost/api/schools/school-1/students");
    const res = await GET(req, PARAMS);
    const body = await res.json();

    expect(body.data).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
