/**
 * Custom-domain ownership verification service. A hostname a school owner
 * claims is NEVER trusted for host resolution until it passes a DNS TXT
 * ownership check (see resolveVerifiedSchoolByHost in school-resolver.ts) —
 * closing the gap where setting `customDomain` alone used to activate host
 * resolution with zero proof of control.
 *
 * DNS resolution runs in the Node runtime only (never Edge — `node:dns` has
 * no Edge equivalent); this module must never be imported into an
 * `export const runtime = "edge"` route.
 */
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { normalizeDomainInput } from "@/lib/domain-normalize";
import type { CustomDomain } from "@/generated/prisma/client";

export const VERIFICATION_RECORD_PREFIX = "_schoolsync-verification";
const ACTIVE_STATUSES = ["PENDING", "VERIFYING", "VERIFIED", "FAILED"] as const;

export function generateDomainVerificationToken(): string {
  return randomBytes(24).toString("hex"); // 192 bits — crypto-secure, not guessable
}

export function verificationRecordName(hostname: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${hostname}`;
}

export function verificationRecordValue(token: string): string {
  return `schoolsync-verification=${token}`;
}

export type DnsCheckResult = { verified: true } | { verified: false; reason: string };

/** Looks up the TXT record and checks it against the expected token value. Never throws. */
export async function checkDnsTxtOwnership(hostname: string, token: string): Promise<DnsCheckResult> {
  const recordName = verificationRecordName(hostname);
  const expected = verificationRecordValue(token);
  try {
    const records = await resolveTxt(recordName);
    // Node splits long TXT strings into chunks per record; join each record's chunks.
    const flattened = records.map((chunks) => chunks.join(""));
    if (flattened.includes(expected)) return { verified: true };
    return { verified: false, reason: "TXT record found but its value does not match the expected token" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { verified: false, reason: "No TXT record found at " + recordName };
    }
    return { verified: false, reason: "DNS lookup failed" };
  }
}

export type CreateDomainResult =
  | { ok: true; domain: CustomDomain }
  | { ok: false; status: number; error: string };

/**
 * Requests a new custom domain for a school. Refuses when the school already
 * has an active (non-DISABLED) domain request — disable it first — and when
 * the normalized hostname is already claimed by ANY school (including
 * historically, even if since disabled; see the schema note on
 * CustomDomain.normalizedHostname for the accepted simplification).
 */
export async function createDomainRequest(schoolId: string, rawHostname: string): Promise<CreateDomainResult> {
  const normalized = normalizeDomainInput(rawHostname);
  if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };

  const existingForSchool = await prisma.customDomain.findFirst({
    where: { schoolId, status: { in: [...ACTIVE_STATUSES] } },
  });
  if (existingForSchool) {
    return { ok: false, status: 409, error: "This school already has an active custom domain request. Disable it first." };
  }

  const existingHostname = await prisma.customDomain.findUnique({
    where: { normalizedHostname: normalized.hostname },
    select: { id: true },
  });
  if (existingHostname) {
    // Never disclose which school owns it.
    return { ok: false, status: 409, error: "This domain is already in use." };
  }

  try {
    const domain = await prisma.customDomain.create({
      data: {
        schoolId,
        hostname: normalized.hostname,
        normalizedHostname: normalized.hostname,
        status: "PENDING",
        verificationToken: generateDomainVerificationToken(),
      },
    });
    return { ok: true, domain };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { ok: false, status: 409, error: "This domain is already in use." };
    }
    throw err;
  }
}

export type VerifyDomainResult =
  | { ok: true; domain: CustomDomain; verified: boolean }
  | { ok: false; status: number; error: string };

/** Runs the DNS TXT check for the school's current domain request and updates its status. */
export async function verifyDomainRequest(schoolId: string, domainId: string): Promise<VerifyDomainResult> {
  const domain = await prisma.customDomain.findFirst({ where: { id: domainId, schoolId } });
  if (!domain) return { ok: false, status: 404, error: "Domain request not found" };
  if (domain.status === "DISABLED") return { ok: false, status: 400, error: "This domain has been disabled" };
  if (domain.status === "VERIFIED") return { ok: true, domain, verified: true };

  await prisma.customDomain.update({ where: { id: domain.id }, data: { status: "VERIFYING" } });

  const result = await checkDnsTxtOwnership(domain.normalizedHostname, domain.verificationToken);
  const now = new Date();
  const updated = await prisma.customDomain.update({
    where: { id: domain.id },
    data: result.verified
      ? { status: "VERIFIED", verifiedAt: now, lastCheckedAt: now, failureReason: null }
      : { status: "FAILED", lastCheckedAt: now, failureReason: result.reason.slice(0, 300) },
  });

  return { ok: true, domain: updated, verified: result.verified };
}

/** Disables a school's custom domain (soft — history is preserved, not deleted). */
export async function disableDomain(schoolId: string, domainId: string): Promise<boolean> {
  const res = await prisma.customDomain.updateMany({
    where: { id: domainId, schoolId, status: { not: "DISABLED" } },
    data: { status: "DISABLED" },
  });
  return res.count === 1;
}

/** The school's current (most recent, any status) custom domain request, if any. */
export function getDomainForSchool(schoolId: string) {
  return prisma.customDomain.findFirst({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
  });
}

/** Resolves a VERIFIED custom domain to its school — the ONLY host-resolution entry point that may trust customDomain-style input. */
export function findVerifiedSchoolIdByHostname(normalizedHostname: string) {
  return prisma.customDomain.findFirst({
    where: { normalizedHostname, status: "VERIFIED" },
    select: { schoolId: true },
  });
}
