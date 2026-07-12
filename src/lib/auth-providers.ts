/**
 * The three web-login `authorize()` functions wired into NextAuth's
 * CredentialsProvider entries in src/lib/auth.ts.
 *
 * Deliberately split out of auth.ts: auth.ts's top-level `NextAuth({...})`
 * call pulls in next-auth's own Next.js-environment detection (which imports
 * `next/server`), which only resolves correctly inside a real Next.js
 * build/dev process — not a plain Node/Vitest run. Keeping the actual
 * provider-boundary logic here, with zero dependency on the `NextAuth(...)`
 * call itself, lets tests exercise the exact functions NextAuth invokes
 * (proving Founder/staff separation and role-forgery-is-inert at the real
 * provider boundary, not just at the underlying src/lib/auth-web.ts helpers)
 * without needing a Next.js runtime. See tests/auth-providers.test.ts.
 */
import { CredentialsSignin } from "next-auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";
import { authenticateStudentForMobile } from "@/lib/mobile-auth";
import { authenticateStaffForWeb, authenticateFounderForWeb } from "@/lib/auth-web";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  NoAccountError as SharedNoAccountError,
  InvalidPasswordError as SharedInvalidPasswordError,
  AmbiguousSchoolError as SharedAmbiguousSchoolError,
  RateLimitedError as SharedRateLimitedError,
} from "@/lib/auth-errors";
import { authBucketKey, guardAgainstLock, recordFailedCredential, completeSuccessfulWebLogin } from "@/lib/auth-login-flow";
import { systemClock } from "@/lib/clock";

async function requestHeaders() {
  return headers();
}

// Distinct `code` values so the login pages can show "no account" vs "wrong
// password" instead of a generic message — surfaced via signIn()'s `code`
// field. NOTE: the unified /login and /founder/login pages deliberately
// display the SAME generic "Invalid credentials" text for no-account,
// invalid-password AND role-mismatch failures (see src/lib/auth-web.ts) —
// these distinct `code`s remain available for server-side audit/telemetry
// consumers, not for differentiating the user-facing message.
export class NoAccountError extends CredentialsSignin {
  code = "no-account";
}
export class InvalidPasswordError extends CredentialsSignin {
  code = "invalid-password";
}
export class RateLimitedError extends CredentialsSignin {
  code = "rate-limited";
}
export class AmbiguousSchoolError extends CredentialsSignin {
  code = "ambiguous-school";
}

/** Translates the shared, non-NextAuth error classes thrown by src/lib/auth-web.ts
 * and src/lib/mobile-auth.ts into this module's CredentialsSignin subclasses.
 * Returns null for anything unrecognized so the caller can fall back to the
 * same "log and return null" behavior NextAuth expects from authorize(). */
function translateSharedError(err: unknown): CredentialsSignin | null {
  if (err instanceof CredentialsSignin) return err;
  if (err instanceof SharedNoAccountError) return new NoAccountError();
  if (err instanceof SharedInvalidPasswordError) return new InvalidPasswordError();
  if (err instanceof SharedRateLimitedError) return new RateLimitedError();
  if (err instanceof SharedAmbiguousSchoolError) return new AmbiguousSchoolError();
  return null;
}

type RawCredentials = Record<string, unknown> | undefined;

/**
 * Owner / Admin / Vice Principal / Teacher web login used exclusively by the
 * unified /login page. FOUNDER credentials are rejected server-side inside
 * authenticateStaffForWeb (src/lib/auth-web.ts) as a generic "no account"
 * failure — this authorize function can never return a Founder session.
 *
 * SECURITY: only `credentials.email` and `credentials.password` are ever
 * read. Any other field on the submitted credentials object (e.g. a forged
 * `role`) is ignored by construction — there is no code path that reads it,
 * and the account's real role always comes from the database lookup inside
 * authenticateStaffForWeb.
 */
export async function staffAuthorize(credentials: RawCredentials) {
  if (!credentials?.email || !credentials?.password) return null;

  const hdrs = await requestHeaders();
  try {
    return await authenticateStaffForWeb(credentials.email as string, credentials.password as string, hdrs);
  } catch (err) {
    const translated = translateSharedError(err);
    if (translated) throw translated;
    console.error("Login error:", err);
    return null;
  }
}

/**
 * Founder-only web login used exclusively by /founder/login. A fully valid
 * Owner/Admin/VP/Teacher/Student credential is rejected server-side inside
 * authenticateFounderForWeb (src/lib/auth-web.ts) as a generic "no account"
 * failure — this authorize function can never return a non-Founder session,
 * so the normal school login flow can never accidentally (or deliberately)
 * reach Founder access through here, and this page can never be used to
 * authenticate as anything other than Founder.
 *
 * SECURITY: same role-forgery note as staffAuthorize above — only email and
 * password are ever read from the submitted credentials.
 */
export async function founderAuthorize(credentials: RawCredentials) {
  if (!credentials?.email || !credentials?.password) return null;

  const hdrs = await requestHeaders();
  try {
    return await authenticateFounderForWeb(credentials.email as string, credentials.password as string, hdrs);
  } catch (err) {
    const translated = translateSharedError(err);
    if (translated) throw translated;
    console.error("Founder login error:", err);
    return null;
  }
}

/** Student web login used by the unified /login page when the typed
 * identifier has no "@" (see src/lib/login-identifier.ts). Delegates
 * identity/password resolution to authenticateStudentForMobile
 * (src/lib/mobile-auth.ts) and layers the same rate-limit/lockout bucket
 * orchestration used by every other credential-login entry point. */
export async function studentAuthorize(credentials: RawCredentials, req: { headers: Headers }) {
  if (!credentials?.identifier || !credentials?.password) return null;

  const ip = getClientIpFromHeaders(req.headers);
  const identifier = (credentials.identifier as string).trim();
  const schoolSlugHint = (() => {
    const slug = credentials.schoolSlug;
    return typeof slug === "string" ? slug : null;
  })();

  try {
    const limit = await rateLimit(
      `student-login:${ip ?? "unknown"}:${identifier.toLowerCase()}`,
      RATE_LIMIT_POLICIES.studentLogin
    );
    if (!limit.allowed) throw new RateLimitedError();

    const now = systemClock.now();
    const resolvedForBucket =
      (await resolveSchool(hostnameFromHeaders(req.headers))) ??
      (schoolSlugHint ? await prisma.school.findUnique({ where: { slug: schoolSlugHint }, select: { id: true } }) : null);
    const bucketKey = resolvedForBucket ? authBucketKey(resolvedForBucket.id, "PARENT_STUDENT", identifier) : null;

    if (bucketKey) {
      const lock = await guardAgainstLock(bucketKey, now);
      if (lock.locked) throw new RateLimitedError();
    }

    let result;
    try {
      result = await authenticateStudentForMobile(identifier, credentials.password as string, req.headers, { slug: schoolSlugHint });
    } catch (err) {
      if (bucketKey && resolvedForBucket && (err instanceof SharedNoAccountError || err instanceof SharedInvalidPasswordError)) {
        await recordFailedCredential(bucketKey, resolvedForBucket.id, "PARENT_STUDENT", now);
      }
      throw err;
    }
    if (!result) return null;

    if (bucketKey) {
      const completion = await completeSuccessfulWebLogin({
        bucketKey,
        actor: { schoolId: result.student.schoolId, actorType: "STUDENT", studentId: result.student.id },
        now,
      });
      if (!completion.ok) throw new RateLimitedError();
    }

    return {
      id: result.student.id,
      name: result.student.name,
      email: result.student.email,
      role: "STUDENT",
      schoolId: result.student.schoolId,
      schoolSlug: result.school.slug,
      teacherId: null,
      mentorSectionId: null,
      studentId: result.student.id,
      sectionId: result.student.sectionId,
    };
  } catch (err) {
    const translated = translateSharedError(err);
    if (translated) throw translated;
    console.error("Student login error:", err);
    return null;
  }
}
