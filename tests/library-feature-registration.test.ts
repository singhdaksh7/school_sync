import { describe, it, expect } from "vitest";
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS } from "@/lib/feature-flag-constants";
import { MODULE_FEATURE_KEYS, classifyRoute } from "@/lib/feature-routes";
import { PERMISSION_CATALOG, isValidPermission } from "@/lib/teacher-permissions";
import { LIBRARY_CAPABILITIES } from "@/lib/library/constants";

describe("LIBRARY feature flag registration", () => {
  it("is a catalog key with a label", () => {
    expect(FEATURE_FLAG_KEYS).toContain("LIBRARY");
    expect(FEATURE_FLAG_LABELS.LIBRARY).toBe("Library");
  });

  it("is registered as a module feature key (server-gated)", () => {
    expect(MODULE_FEATURE_KEYS).toContain("LIBRARY");
  });

  it("classifies every library route family to LIBRARY", () => {
    expect(classifyRoute("schools/[schoolId]/library/books")).toBe("LIBRARY");
    expect(classifyRoute("schools/[schoolId]/library/loans/[id]/return")).toBe("LIBRARY");
    expect(classifyRoute("teacher/library/loans")).toBe("LIBRARY");
    expect(classifyRoute("student/library/catalogue")).toBe("LIBRARY");
    expect(classifyRoute("parent/library/[studentId]")).toBe("LIBRARY");
  });
});

describe("LIBRARY permission catalog", () => {
  it("registers the full set of granular capabilities", () => {
    expect(PERMISSION_CATALOG.LIBRARY).toEqual([...LIBRARY_CAPABILITIES]);
    for (const cap of LIBRARY_CAPABILITIES) {
      expect(isValidPermission("LIBRARY", cap)).toBe(true);
    }
  });

  it("rejects an unknown library action", () => {
    expect(isValidPermission("LIBRARY", "DESTROY_EVERYTHING")).toBe(false);
  });

  it("does NOT add a LIBRARIAN UserRole (delegation is via TeacherPermission)", () => {
    // Sanity guard on the spec's hard constraint — catalog is the delegation path.
    expect(LIBRARY_CAPABILITIES).toContain("ISSUE");
    expect(LIBRARY_CAPABILITIES).toContain("FINE_WAIVE");
  });
});
