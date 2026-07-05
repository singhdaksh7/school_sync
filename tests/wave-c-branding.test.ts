import { describe, it, expect, vi } from "vitest";
import { brandingForSchool, normalizeBrandingColor, DEFAULT_BRANDING, type BrandingSchool } from "@/lib/school-resolver";
import { reportCardToPdfInput } from "@/lib/report-cards";

const school: BrandingSchool = {
  id: "s1",
  name: "Green Valley School",
  slug: "green-valley",
  customDomain: null,
  logoUrl: "https://legacy.example.com/logo.png",
  logoFile: { storageKey: "branding_image/s1/2026/07/logo.png" },
  primaryColor: "#123456",
  secondaryColor: "#654321",
  appName: "Green Valley ERP",
  poweredBySchoolSync: false,
};

describe("colour normalization — never accepts arbitrary CSS", () => {
  it("accepts a well-formed 6-digit hex colour", () => {
    expect(normalizeBrandingColor("#123abc", "#000000")).toBe("#123abc");
  });

  it("falls back for a non-hex / arbitrary CSS value", () => {
    expect(normalizeBrandingColor("red", "#000000")).toBe("#000000");
    expect(normalizeBrandingColor("url(javascript:alert(1))", "#000000")).toBe("#000000");
    expect(normalizeBrandingColor("#12345", "#000000")).toBe("#000000"); // too short
    expect(normalizeBrandingColor("#1234567", "#000000")).toBe("#000000"); // too long
  });

  it("falls back for null/empty", () => {
    expect(normalizeBrandingColor(null, "#000000")).toBe("#000000");
    expect(normalizeBrandingColor("", "#000000")).toBe("#000000");
  });
});

describe("brandingForSchool — WHITE_LABEL product rule", () => {
  it("returns the school's own branding when WHITE_LABEL is enabled", () => {
    const previous = process.env.STORAGE_PUBLIC_BASE_URL;
    process.env.STORAGE_PUBLIC_BASE_URL = "https://cdn.example.com";
    try {
      const branding = brandingForSchool(school, { whiteLabelEnabled: true });
      expect(branding.schoolName).toBe("Green Valley School");
      expect(branding.appName).toBe("Green Valley ERP");
      expect(branding.primaryColor).toBe("#123456");
      expect(branding.secondaryColor).toBe("#654321");
      expect(branding.poweredBySchoolSync).toBe(false);
      expect(branding.logoUrl).toContain("branding_image"); // managed logo takes precedence over legacy logoUrl
    } finally {
      if (previous === undefined) delete process.env.STORAGE_PUBLIC_BASE_URL;
      else process.env.STORAGE_PUBLIC_BASE_URL = previous;
    }
  });

  it("falls back to the legacy logoUrl when no public storage base URL is configured", () => {
    const branding = brandingForSchool(school, { whiteLabelEnabled: true });
    expect(branding.logoUrl).toBe("https://legacy.example.com/logo.png");
  });

  it("falls back to safe co-branded defaults when WHITE_LABEL is disabled, even though branding is saved", () => {
    const branding = brandingForSchool(school, { whiteLabelEnabled: false });
    expect(branding.schoolName).toBe("Green Valley School"); // real identity still shown — not premium
    expect(branding.appName).toBe("Green Valley School"); // custom appName override suppressed
    expect(branding.logoUrl).toBeNull(); // custom logo suppressed
    expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    expect(branding.secondaryColor).toBe(DEFAULT_BRANDING.secondaryColor);
    // Attribution is forced ON even though the school had explicitly saved poweredBySchoolSync=false —
    // hiding the platform attribution is itself a white-label capability.
    expect(branding.poweredBySchoolSync).toBe(true);
  });

  it("never deletes/mutates the underlying school object when falling back", () => {
    const before = JSON.stringify(school);
    brandingForSchool(school, { whiteLabelEnabled: false });
    expect(JSON.stringify(school)).toBe(before);
  });

  it("returns the platform default when no school is resolved", () => {
    expect(brandingForSchool(null)).toEqual(DEFAULT_BRANDING);
  });

  it("falls back for an invalid stored colour even when WHITE_LABEL is enabled", () => {
    const malformed: BrandingSchool = { ...school, primaryColor: "not-a-color" };
    const branding = brandingForSchool(malformed, { whiteLabelEnabled: true });
    expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
  });
});

describe("report-card PDF — WHITE_LABEL gates the school-level logo fallback and attribution", () => {
  const card = {
    school: {
      name: "Green Valley School",
      logoUrl: "https://legacy.example.com/logo.png",
      logoFile: { storageKey: "branding_image/s1/logo.png", contentType: "image/png" },
      poweredBySchoolSync: false,
    },
    student: { name: "Aarav Sharma", rollNo: "12", section: { name: "A", class: { name: "8" } } },
    examScheme: { name: "Annual Exam" },
    generatedByTeacher: { name: "Mrs. Iyer" },
    subjects: [],
    totalMarks: 0,
    percentage: 0,
    grade: "A",
    attendanceSummary: JSON.stringify({ totalDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, percentage: null }),
    classTeacherRemark: null,
    publishedAt: null,
    templateSnapshot: null,
  };

  it("includes the school logo and honors the stored poweredBySchoolSync when WHITE_LABEL is enabled", () => {
    const input = reportCardToPdfInput(card, { whiteLabelEnabled: true });
    expect(input.logoUrl).toBe("https://legacy.example.com/logo.png");
    expect(input.schoolLogoAsset).toEqual({ storageKey: "branding_image/s1/logo.png", contentType: "image/png" });
    expect(input.poweredBySchoolSync).toBe(false);
  });

  it("suppresses the school logo and forces attribution on when WHITE_LABEL is disabled", () => {
    const input = reportCardToPdfInput(card, { whiteLabelEnabled: false });
    expect(input.logoUrl).toBeNull();
    expect(input.schoolLogoAsset).toBeNull();
    expect(input.poweredBySchoolSync).toBe(true);
  });

  it("defaults to whiteLabelEnabled: true when no opts are passed (back-compat)", () => {
    const input = reportCardToPdfInput(card);
    expect(input.logoUrl).toBe("https://legacy.example.com/logo.png");
  });
});

describe("tenant email identity classification", () => {
  vi.mock("@/lib/prisma", () => ({
    prisma: {
      teacher: {
        findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
          if (where.userId === "teacher-user") return { school: { name: "Teacher's School" } };
          return null;
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === "owner-user") return { ownedSchool: { name: "Owned School" }, school: null };
          if (where.id === "admin-user") return { ownedSchool: null, school: { name: "Admin's School" } };
          return { ownedSchool: null, school: null };
        }),
      },
    },
  }));

  it("classifies a Founder account as platform identity (no school)", async () => {
    const { resolveSchoolNameForUser } = await import("@/lib/email");
    expect(await resolveSchoolNameForUser("founder-user", "FOUNDER")).toBeNull();
  });

  it("classifies a Teacher account via their Teacher.school relation", async () => {
    const { resolveSchoolNameForUser } = await import("@/lib/email");
    expect(await resolveSchoolNameForUser("teacher-user", "TEACHER")).toBe("Teacher's School");
  });

  it("classifies a School Owner account via User.ownedSchool", async () => {
    const { resolveSchoolNameForUser } = await import("@/lib/email");
    expect(await resolveSchoolNameForUser("owner-user", "SCHOOL_OWNER")).toBe("Owned School");
  });

  it("classifies a School Admin account via User.school", async () => {
    const { resolveSchoolNameForUser } = await import("@/lib/email");
    expect(await resolveSchoolNameForUser("admin-user", "SCHOOL_ADMIN")).toBe("Admin's School");
  });
});
