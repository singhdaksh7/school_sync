import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyRoute, isExemptRoute } from "@/lib/feature-routes";

function src(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/app/api/${relPath}`, import.meta.url)), "utf8");
}

const chainRoute = src("schools/[schoolId]/operational-roles/teacher-operations/route.ts");
const effectiveRoute = src("schools/[schoolId]/operational-roles/teacher-operations/effective/route.ts");
const selfStatusRoute = src("teacher/operational-roles/self-status/route.ts");
const leavesListRoute = src("schools/[schoolId]/leaves/route.ts");
const leaveDetailRoute = src("schools/[schoolId]/leaves/[leaveId]/route.ts");
const arrangementsRoute = src("schools/[schoolId]/arrangements/route.ts");
const autoGenerateRoute = src("schools/[schoolId]/arrangements/auto-generate/route.ts");
const teacherStatusRoute = src("schools/[schoolId]/operations/teachers/status/route.ts");

// ── PART 21: Admin configuration API ──────────────────────────────────────────
describe("operational-roles/teacher-operations config route (PART 21)", () => {
  it("GET is Owner/Admin/VP (canAccessSchool), PUT is Owner/Admin-only (canWriteSchool)", () => {
    expect(chainRoute).toMatch(/export async function GET[\s\S]*?canAccessSchool\(/);
    expect(chainRoute).toMatch(/export async function PUT[\s\S]*?canWriteSchool\(/);
  });

  it("both GET and PUT are gated by TEACHER_PERMISSIONS (PART 27)", () => {
    const gateCount = (chainRoute.match(/requireSchoolFeature\(schoolId,\s*"TEACHER_PERMISSIONS"\)/g) || []).length;
    expect(gateCount).toBe(2);
  });

  it("PUT is classified STANDARD categories correctly (GET=STANDARD_READ, PUT=MUTATION)", () => {
    expect(chainRoute).toContain('"STANDARD_READ"');
    expect(chainRoute).toContain('"MUTATION"');
  });

  it("PUT logs TEACHER_OPERATIONS_CHAIN_UPDATED with before/after summaries, never a partial save on invalid input", () => {
    expect(chainRoute).toContain('"TEACHER_OPERATIONS_CHAIN_UPDATED"');
    expect(chainRoute).toMatch(/before:/);
    expect(chainRoute).toMatch(/after:/);
    expect(chainRoute).toMatch(/if \(!result\.ok\) return NextResponse\.json/);
  });

  it("is classified TEACHER_PERMISSIONS in the feature-route registry", () => {
    expect(classifyRoute("schools/[schoolId]/operational-roles/teacher-operations")).toBe("TEACHER_PERMISSIONS");
  });
});

// ── PART 22: effective-status + teacher self-status APIs ─────────────────────
describe("operational-roles/teacher-operations/effective + teacher self-status (PART 22)", () => {
  it("effective status route allows Owner/Admin/VP OR any teacher in the school, and is NOT feature-gated", () => {
    expect(effectiveRoute).toContain("canAccessSchool(");
    expect(effectiveRoute).not.toContain("requireSchoolFeature");
  });

  it("effective status route is a documented feature-gate exemption, not silently unclassified", () => {
    expect(classifyRoute("schools/[schoolId]/operational-roles/teacher-operations/effective")).toBeNull();
    expect(isExemptRoute("schools/[schoolId]/operational-roles/teacher-operations/effective")).toBe(true);
  });

  it("teacher self-status route uses getTeacherAuth, is actor-keyed as TEACHER for Cost Guard, and is NOT feature-gated", () => {
    expect(selfStatusRoute).toContain("getTeacherAuth(");
    expect(selfStatusRoute).toContain('actorType: "TEACHER"');
    expect(selfStatusRoute).not.toContain("requireSchoolFeature");
  });

  it("teacher self-status route is a documented feature-gate exemption", () => {
    expect(classifyRoute("teacher/operational-roles/self-status")).toBeNull();
    expect(isExemptRoute("teacher/operational-roles/self-status")).toBe(true);
  });

  it("teacher self-status response never exposes the full leadership chain to an unrelated teacher", () => {
    const responseObject = selfStatusRoute.slice(selfStatusRoute.indexOf("return NextResponse.json({"));
    expect(responseObject).not.toMatch(/\bchain\s*:/);
  });
});

// ── PART 15/16: leave approval/rejection + self-approval protection ──────────
describe("leaves routes — operational fallback + self-approval guard (PART 15/16)", () => {
  it("GET (view) and PATCH (approve/reject) both use the operational-capability fallback", () => {
    expect(leavesListRoute).toContain("requireSchoolAccessOrOperationalCapability(");
    expect(leaveDetailRoute).toContain("requireSchoolAccessOrOperationalCapability(");
  });

  it("PATCH rejects self-approval with a stable SELF_LEAVE_APPROVAL_FORBIDDEN code, checked server-side before the mutation", () => {
    expect(leaveDetailRoute).toContain("SELF_LEAVE_APPROVAL_FORBIDDEN");
    const selfCheckIndex = leaveDetailRoute.indexOf("SELF_LEAVE_APPROVAL_FORBIDDEN");
    const updateIndex = leaveDetailRoute.indexOf("leaveRequest.updateMany");
    expect(selfCheckIndex).toBeGreaterThan(0);
    expect(selfCheckIndex).toBeLessThan(updateIndex);
  });

  it("delegated audit metadata is attached to the LEAVE_APPROVED/REJECTED audit entry", () => {
    expect(leaveDetailRoute).toContain("buildDelegatedAuditMetadata(");
  });
});

// ── PART 18/28: arrangement routes — manual assign + lifecycle on the fallback path ─
describe("arrangements routes — manual assignment + lifecycle safety (PART 18/28)", () => {
  it("a POST handler exists for manual single-lecture assignment, reusing assignArrangement", () => {
    expect(arrangementsRoute).toContain("export async function POST");
    expect(arrangementsRoute).toContain("assignArrangement(");
  });

  it("the arrangements list/assign route checks school lifecycle before EITHER the admin or operational path", () => {
    expect(arrangementsRoute).toContain("schoolLifecycleGate(");
  });

  it("auto-generate route re-checks school lifecycle on the teacher-delegation fallback specifically", () => {
    const fallbackSection = autoGenerateRoute.slice(autoGenerateRoute.indexOf('role !== "TEACHER"'));
    expect(fallbackSection).toContain("schoolLifecycleGate(");
  });

  it("reuses the day-specific rankReplacementTeachers/arrangements engine — never Smart Timetable's weekly recommender", () => {
    expect(arrangementsRoute + autoGenerateRoute).not.toContain("recommendTeachers(");
  });
});

// ── PART 14/17: teacher attendance management route ───────────────────────────
describe("operations/teachers/status route — capability guard (PART 14)", () => {
  it("GET uses TEACHER_STATUS_VIEW, PATCH uses TEACHER_ATTENDANCE_MANAGE as a write-mode capability", () => {
    expect(teacherStatusRoute).toContain('"TEACHER_STATUS_VIEW"');
    expect(teacherStatusRoute).toMatch(/guardOperationsCapability\([^)]*"TEACHER_ATTENDANCE_MANAGE"[^)]*,\s*true\s*\)/);
  });

  it("delegated audit metadata is attached to the bulk status mutation", () => {
    expect(teacherStatusRoute).toContain("buildDelegatedAuditMetadata(");
  });
});
