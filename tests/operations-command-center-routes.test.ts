import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyRoute, isExemptRoute } from "@/lib/feature-routes";

const OPERATIONS_DIR = fileURLToPath(new URL("../src/app/api/schools/[schoolId]/operations", import.meta.url));

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const routeFiles = collectRouteFiles(OPERATIONS_DIR).map((file) => ({
  file,
  routePath: `schools/[schoolId]/operations/${path.relative(OPERATIONS_DIR, file).replace(/\\/g, "/").replace(/\/route\.ts$/, "")}`.replace(/\/$/, ""),
  source: readFileSync(file, "utf8"),
}));

// ── PART 22/23: every route uses the shared guard, never a bespoke auth check ──
describe("operations route family — shared guard usage (PART 22/23)", () => {
  it("discovers the full operations route surface", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(13);
  });

  it("every exported handler is preceded by a guardOperationsRead/Write/Capability call", () => {
    const offenders: string[] = [];
    for (const { routePath, source } of routeFiles) {
      const handlerCount = (source.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) || []).length;
      const guardCount = (source.match(/guardOperations(Read|Write|Capability)\(/g) || []).length;
      if (handlerCount === 0 || guardCount < handlerCount) {
        offenders.push(`${routePath}: ${handlerCount} handler(s) vs ${guardCount} guard call(s)`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no route re-implements auth/canAccessSchool directly instead of using the shared guard", () => {
    for (const { routePath, source } of routeFiles) {
      expect(source.includes("canAccessSchool("), `${routePath} should go through guardOperationsRead, not call canAccessSchool directly`).toBe(false);
    }
  });

  it("the write route (teachers/status PATCH) uses a write-mode guard (guardOperationsWrite or guardOperationsCapability(..., true)), never a read-mode guard", () => {
    const target = routeFiles.find((r) => r.routePath === "schools/[schoolId]/operations/teachers/status")!;
    expect(target).toBeTruthy();
    const patchSection = target.source.slice(target.source.indexOf("export async function PATCH"));
    const usesWriteGuard = /guardOperationsWrite\(/.test(patchSection) || /guardOperationsCapability\([^)]*,\s*true\s*\)/.test(patchSection);
    expect(usesWriteGuard, patchSection).toBe(true);
  });
});

// ── PART 25: Cost Guard classification per route ──────────────────────────────
const EXPECTED_CATEGORY: Record<string, string> = {
  "schools/[schoolId]/operations/today": "STANDARD_READ",
  "schools/[schoolId]/operations/teachers/status": "STANDARD_READ", // GET; PATCH uses MUTATION, checked separately
  "schools/[schoolId]/operations/attendance": "STANDARD_READ",
  "schools/[schoolId]/operations/lecture-coverage": "STANDARD_READ",
  "schools/[schoolId]/operations/current-period": "STANDARD_READ",
  "schools/[schoolId]/operations/next-period-risk": "STANDARD_READ",
  "schools/[schoolId]/operations/teacher-workload": "STANDARD_READ",
  "schools/[schoolId]/operations/attention": "STANDARD_READ",
  "schools/[schoolId]/operations/homework": "STANDARD_READ",
  "schools/[schoolId]/operations/exams": "STANDARD_READ",
  "schools/[schoolId]/operations/report-cards": "STANDARD_READ",
  "schools/[schoolId]/operations/fees": "STANDARD_READ",
  "schools/[schoolId]/operations/activity": "STANDARD_READ",
  "schools/[schoolId]/operations/daily-summary": "EXPENSIVE_READ",
};

describe("operations route family — Cost Guard category classification (PART 25)", () => {
  it("every GET route is classified to its documented category", () => {
    const offenders: string[] = [];
    for (const { routePath, source } of routeFiles) {
      const expected = EXPECTED_CATEGORY[routePath];
      if (!expected) continue;
      if (!source.includes(`"${expected}"`)) offenders.push(`${routePath}: expected ${expected}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the bulk teacher-status mutation is classified MUTATION", () => {
    const target = routeFiles.find((r) => r.routePath === "schools/[schoolId]/operations/teachers/status")!;
    const patchSection = target.source.slice(target.source.indexOf("export async function PATCH"));
    expect(patchSection.includes('"MUTATION"')).toBe(true);
  });

  it("every documented category is a real ApiCostCategory", () => {
    const known = new Set(["STANDARD_READ", "EXPENSIVE_READ", "MUTATION", "UPLOAD", "DOWNLOAD", "PDF", "JOB_CREATE", "JOB_STATUS", "AI_ACTOR", "AI_SCHOOL"]);
    for (const category of Object.values(EXPECTED_CATEGORY)) expect(known.has(category)).toBe(true);
  });
});

// ── PART 24: not ANALYTICS-gated — core Today Operations is exempt ────────────
describe("operations route family — feature entitlement (PART 24)", () => {
  it("is classified as an explicit exemption, not gated by any module feature", () => {
    expect(classifyRoute("schools/[schoolId]/operations/today")).toBeNull();
    expect(isExemptRoute("schools/[schoolId]/operations/today")).toBe(true);
  });

  it("no operations route calls requireSchoolFeature (must not require ANALYTICS or any other plan gate)", () => {
    for (const { routePath, source } of routeFiles) {
      expect(source.includes("requireSchoolFeature"), `${routePath} must not be feature-gated`).toBe(false);
    }
  });
});
