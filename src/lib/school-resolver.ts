import { prisma } from "@/lib/prisma";
import { storagePublicUrl } from "@/lib/storage";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { findVerifiedSchoolIdByHostname } from "@/lib/custom-domain";

export type BrandingSchool = {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  logoUrl: string | null;
  logoFile?: { storageKey: string } | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  appName: string | null;
  poweredBySchoolSync: boolean;
};

export type BrandingResponse = {
  schoolName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  appName: string;
  poweredBySchoolSync: boolean;
};

type HeaderReader = {
  get(name: string): string | null;
};

export const DEFAULT_BRANDING: BrandingResponse = {
  schoolName: "SchoolSync",
  logoUrl: null,
  primaryColor: "#2563eb",
  secondaryColor: "#0f172a",
  appName: "SchoolSync",
  poweredBySchoolSync: false,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Validates a stored colour value at READ time too (not just at save time in
 * the branding PATCH route) — defense in depth so a malformed/legacy value
 * can never reach a client as literal CSS. Never accepts arbitrary CSS
 * (gradients, `url()`, etc.), only a plain 6-digit hex colour.
 */
export function normalizeBrandingColor(value: string | null | undefined, fallback: string): string {
  if (value && HEX_COLOR_RE.test(value.trim())) return value.trim();
  return fallback;
}

export function normalizeHostname(hostname: string | null | undefined) {
  if (!hostname) return "";
  const value = hostname
    .split(",")[0]
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (value.startsWith("[") && value.includes("]")) {
    return value.slice(1, value.indexOf("]"));
  }

  return value.includes(":") && value.indexOf(":") === value.lastIndexOf(":")
    ? value.replace(/:\d+$/, "")
    : value;
}

export function hostnameFromHeaders(headers: HeaderReader) {
  return headers.get("host") || headers.get("x-forwarded-host");
}

/**
 * Builds the tenant-facing branding payload for a resolved school.
 *
 * `whiteLabelEnabled` implements the one WHITE_LABEL product rule (see
 * resolveTenantBranding / A8): when the school's WHITE_LABEL entitlement is
 * OFF, none of the CUSTOM branding fields (logo, colours, custom app name,
 * powered-by toggle) render — the surface falls back to the safe, co-branded
 * SchoolSync default look with platform attribution forced on. The school's
 * real NAME still shows (that's basic tenant identity, not a premium
 * customization). The saved configuration is never deleted — disabling the
 * feature only changes what's *displayed*, so re-enabling instantly restores
 * the school's saved branding with no data loss.
 */
export function brandingForSchool(
  school: BrandingSchool | null,
  opts: { whiteLabelEnabled: boolean } = { whiteLabelEnabled: true }
): BrandingResponse {
  if (!school) return DEFAULT_BRANDING;

  if (!opts.whiteLabelEnabled) {
    return {
      schoolName: school.name,
      appName: school.name,
      logoUrl: null,
      primaryColor: DEFAULT_BRANDING.primaryColor,
      secondaryColor: DEFAULT_BRANDING.secondaryColor,
      poweredBySchoolSync: true,
    };
  }

  // BRANDING_IMAGE is always PUBLIC visibility, so its public URL is a plain
  // string join (see storagePublicUrl) — no signing/async needed here.
  const managedLogoUrl = school.logoFile ? storagePublicUrl(school.logoFile.storageKey) : null;
  return {
    schoolName: school.name,
    logoUrl: managedLogoUrl ?? school.logoUrl,
    primaryColor: normalizeBrandingColor(school.primaryColor, DEFAULT_BRANDING.primaryColor),
    secondaryColor: normalizeBrandingColor(school.secondaryColor, DEFAULT_BRANDING.secondaryColor),
    appName: school.appName || school.name,
    poweredBySchoolSync: school.poweredBySchoolSync,
  };
}

function subdomainSlug(hostname: string) {
  if (!hostname || LOCAL_HOSTS.has(hostname)) return null;
  const parts = hostname.split(".");
  if (parts.length < 3) return null;
  const first = parts[0];
  return first && first !== "www" ? first : null;
}

const SCHOOL_BRANDING_SELECT = {
  id: true,
  name: true,
  slug: true,
  customDomain: true,
  logoUrl: true,
  logoFile: { select: { storageKey: true } },
  primaryColor: true,
  secondaryColor: true,
  appName: true,
  poweredBySchoolSync: true,
} as const;

/**
 * Resolves the school for an incoming hostname: a VERIFIED custom domain
 * first (see src/lib/custom-domain.ts — PENDING/VERIFYING/FAILED/DISABLED
 * never match here), then the `{slug}.<platform-domain>` subdomain
 * convention. The legacy `School.customDomain` free-text column is NEVER
 * used for resolution — only for historical/display purposes.
 */
export async function resolveSchool(hostname: string | null | undefined) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return null;

  const verified = await findVerifiedSchoolIdByHostname(normalized);
  if (verified) {
    const school = await prisma.school.findUnique({
      where: { id: verified.schoolId },
      select: SCHOOL_BRANDING_SELECT,
    });
    if (school) return school;
  }

  const slug = subdomainSlug(normalized);
  if (!slug) return null;

  return prisma.school.findUnique({
    where: { slug },
    select: SCHOOL_BRANDING_SELECT,
  });
}

/**
 * THE central tenant branding resolver. Every public/unauthenticated surface
 * that needs to display a school's branding (public /api/branding, the login
 * page it feeds) should call this — never `resolveSchool` + `brandingForSchool`
 * separately — so the WHITE_LABEL entitlement check can never be forgotten at
 * a call site.
 */
export async function resolveTenantBranding(hostname: string | null | undefined): Promise<BrandingResponse> {
  const school = await resolveSchool(hostname);
  if (!school) return DEFAULT_BRANDING;
  const whiteLabelEnabled = await isFeatureEnabled(school.id, "WHITE_LABEL");
  return brandingForSchool(school, { whiteLabelEnabled });
}

/**
 * Lightweight tenant identity for Next.js metadata (`<title>`). Deliberately
 * separate from resolveTenantBranding — a page title only ever needs the
 * display name, never colours/logo, so this stays a single narrow query.
 * Respects the same WHITE_LABEL rule: a custom appName never appears in a
 * browser tab when white-label is off, only the plain school name.
 */
export async function resolveTenantAppName(hostname: string | null | undefined): Promise<string | null> {
  const school = await resolveSchool(hostname);
  if (!school) return null;
  const whiteLabelEnabled = await isFeatureEnabled(school.id, "WHITE_LABEL");
  return whiteLabelEnabled ? school.appName || school.name : school.name;
}

/** Same as resolveTenantAppName but resolves by schoolId (session-derived contexts: dashboard/teacher/student). */
export async function tenantAppNameForSchoolId(schoolId: string): Promise<string | null> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true, appName: true },
  });
  if (!school) return null;
  const whiteLabelEnabled = await isFeatureEnabled(schoolId, "WHITE_LABEL");
  return whiteLabelEnabled ? school.appName || school.name : school.name;
}

/**
 * Same as resolveTenantBranding but resolves by schoolId instead of request
 * hostname — for an authenticated bearer-session caller (mobile) whose tenant
 * is already known from the JWT, never from a client-supplied schoolId/host.
 * Reuses brandingForSchool (the same WHITE_LABEL rule, the same field
 * mapping) so this is a lookup-key change only, never a second branding
 * resolver.
 */
export async function resolveTenantBrandingForSchoolId(schoolId: string): Promise<BrandingResponse> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: SCHOOL_BRANDING_SELECT,
  });
  if (!school) return DEFAULT_BRANDING;
  const whiteLabelEnabled = await isFeatureEnabled(schoolId, "WHITE_LABEL");
  return brandingForSchool(school, { whiteLabelEnabled });
}
