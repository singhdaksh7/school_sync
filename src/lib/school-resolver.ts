import { prisma } from "@/lib/prisma";

export type BrandingSchool = {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  logoUrl: string | null;
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

export const DEFAULT_BRANDING: BrandingResponse = {
  schoolName: "SchoolSync",
  logoUrl: null,
  primaryColor: "#2563eb",
  secondaryColor: "#0f172a",
  appName: "SchoolSync",
  poweredBySchoolSync: false,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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

export function brandingForSchool(school: BrandingSchool | null): BrandingResponse {
  if (!school) return DEFAULT_BRANDING;
  return {
    schoolName: school.name,
    logoUrl: school.logoUrl,
    primaryColor: school.primaryColor || DEFAULT_BRANDING.primaryColor,
    secondaryColor: school.secondaryColor || DEFAULT_BRANDING.secondaryColor,
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

export async function resolveSchool(hostname: string | null | undefined) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return null;

  const byDomain = await prisma.school.findFirst({
    where: { customDomain: { equals: normalized, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      slug: true,
      customDomain: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      appName: true,
      poweredBySchoolSync: true,
    },
  });
  if (byDomain) return byDomain;

  const slug = subdomainSlug(normalized);
  if (!slug) return null;

  return prisma.school.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      customDomain: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      appName: true,
      poweredBySchoolSync: true,
    },
  });
}
