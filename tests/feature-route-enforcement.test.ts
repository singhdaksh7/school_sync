import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  MODULE_FEATURE_KEYS,
  NON_MODULE_FEATURE_KEYS,
  classifyRoute,
  isExemptRoute,
} from "@/lib/feature-routes";
import { FEATURE_FLAG_KEYS } from "@/lib/feature-flag-constants";

const API_DIR = fileURLToPath(new URL("../src/app/api", import.meta.url));

/** Recursively collect every `route.ts` file under src/app/api. */
function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

/** src/app/api/schools/[schoolId]/homework/route.ts -> "schools/[schoolId]/homework" */
function toRoutePath(file: string): string {
  const rel = path.relative(API_DIR, file).replace(/\\/g, "/");
  return rel.replace(/\/route\.ts$/, "");
}

const routeFiles = collectRouteFiles(API_DIR).map((file) => ({
  file,
  routePath: toRoutePath(file),
  source: readFileSync(file, "utf8"),
}));

describe("feature catalog — explicit enforcement decision for every key", () => {
  it("every catalog feature key is classified as either a module key or a non-module key", () => {
    const decided = new Set<string>([...MODULE_FEATURE_KEYS, ...Object.keys(NON_MODULE_FEATURE_KEYS)]);
    for (const key of FEATURE_FLAG_KEYS) {
      expect(decided.has(key), `Feature key ${key} has no explicit enforcement decision`).toBe(true);
    }
    // ...and no phantom keys.
    for (const key of decided) {
      expect((FEATURE_FLAG_KEYS as readonly string[]).includes(key), `${key} is not a real catalog key`).toBe(true);
    }
  });

  it("module and non-module key sets are disjoint", () => {
    for (const key of MODULE_FEATURE_KEYS) {
      expect(Object.keys(NON_MODULE_FEATURE_KEYS)).not.toContain(key);
    }
  });
});

describe("route → feature gate coverage (regression guard for nested routes)", () => {
  it("discovers the full API route surface", () => {
    expect(routeFiles.length).toBeGreaterThan(100);
  });

  it("every route classified to a module feature calls requireSchoolFeature with that key", () => {
    const offenders: string[] = [];
    for (const { routePath, source } of routeFiles) {
      const feature = classifyRoute(routePath);
      if (!feature) continue;
      const callsHelper = source.includes("requireSchoolFeature");
      const namesKey = new RegExp(`requireSchoolFeature\\([^)]*["']${feature}["']`).test(source)
        || source.includes(`"${feature}"`);
      if (!callsHelper || !namesKey) {
        offenders.push(`${routePath} (expected ${feature})`);
      }
    }
    expect(offenders, `Ungated feature-family routes:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every exported HTTP handler in a gated file references the gate at least once", () => {
    // Cheap proxy for "each method gates": count handler exports vs. gate calls.
    const suspicious: string[] = [];
    for (const { routePath, source } of routeFiles) {
      if (!classifyRoute(routePath)) continue;
      const handlerCount = (source.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) || []).length;
      const gateCount = (source.match(/requireSchoolFeature\(/g) || []).length;
      if (handlerCount > 0 && gateCount < handlerCount) {
        suspicious.push(`${routePath}: ${handlerCount} handlers but ${gateCount} gate call(s)`);
      }
    }
    expect(suspicious, `Handlers possibly missing a gate:\n${suspicious.join("\n")}`).toEqual([]);
  });

  it("classified feature keys are all real module keys", () => {
    for (const { routePath } of routeFiles) {
      const feature = classifyRoute(routePath);
      if (feature) expect(MODULE_FEATURE_KEYS).toContain(feature);
    }
  });
});

describe("explicit platform/system exemptions stay ungated", () => {
  const exemptExamples = [
    "founder/plans",
    "founder/revenue",
    "founder/schools/[schoolId]/feature-flags",
    "schools/[schoolId]/payment-proofs",
    "schools/[schoolId]/invoices",
    "branding",
    "auth/reset-password",
    "health",
    "parent/fees/create-order",
    "parent/fees/verify-payment",
  ];

  it("known platform routes are recognised as intentional exemptions and are NOT classified to a module", () => {
    for (const routePath of exemptExamples) {
      expect(classifyRoute(routePath), `${routePath} must not be gated`).toBeNull();
      expect(isExemptRoute(routePath), `${routePath} must be a documented exemption`).toBe(true);
    }
  });

  it("no founder control-plane route calls requireSchoolFeature", () => {
    for (const { routePath, source } of routeFiles) {
      if (routePath.startsWith("founder/")) {
        expect(source.includes("requireSchoolFeature"), `${routePath} must not gate the founder plane`).toBe(false);
      }
    }
  });

  it("the SaaS billing recovery + public branding routes are not feature-gated", () => {
    const mustBeUngated = [
      "schools/[schoolId]/payment-proofs",
      "schools/[schoolId]/invoices",
      "branding",
    ];
    for (const rp of mustBeUngated) {
      const match = routeFiles.find((r) => r.routePath === rp);
      expect(match, `route ${rp} not found`).toBeTruthy();
      expect(match!.source.includes("requireSchoolFeature"), `${rp} should stay ungated`).toBe(false);
    }
  });
});
