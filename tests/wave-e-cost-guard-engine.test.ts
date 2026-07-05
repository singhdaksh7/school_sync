import { describe, it, expect } from "vitest";
import { resolveCooldownMs, FAILED_LOGIN_ESCALATION } from "@/lib/cost-guard-policy";
import { normalizeIdentifier, hashAuthBucketKey, hashIp, hashSessionIdentifier } from "@/lib/identifier-hash";
import { FixedClock } from "@/lib/clock";
import { computePayloadFingerprint } from "@/lib/job-dedup";
import {
  homeworkAttachmentRetention,
  homeworkSubmissionRetention,
  studentImportSourceRetention,
  PAYMENT_PROOF_RETENTION,
  REFERENCE_MANAGED_RETENTION,
} from "@/lib/file-retention";
import { rateLimitedResponse, authLockResponse, newLoginLimitResponse, genericInvalidCredentialsResponse } from "@/lib/auth-response";

describe("failed-password escalation policy resolution (PART 5)", () => {
  it("attempts 1-2 have no cooldown", () => {
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 1)).toBeNull();
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 2)).toBeNull();
  });

  it("parent/student escalates 1min -> 15min -> 6h", () => {
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 3)).toBe(60_000);
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 4)).toBe(15 * 60_000);
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 5)).toBe(6 * 60 * 60_000);
  });

  it("teacher escalates 1min -> 10min -> 1h", () => {
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.TEACHER, 3)).toBe(60_000);
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.TEACHER, 4)).toBe(10 * 60_000);
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.TEACHER, 5)).toBe(60 * 60_000);
  });

  it("attempts beyond the max repeat the max-attempt (lock) duration", () => {
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 6)).toBe(6 * 60 * 60_000);
    expect(resolveCooldownMs(FAILED_LOGIN_ESCALATION.PARENT_STUDENT, 100)).toBe(6 * 60 * 60_000);
  });
});

describe("identifier hashing (PART 10) — PII-safe, deterministic", () => {
  it("normalizes case/whitespace before hashing", () => {
    expect(normalizeIdentifier(" John@Example.com ")).toBe("john@example.com");
  });

  it("produces the same bucket key for equivalent identifiers", () => {
    const a = hashAuthBucketKey("school-1", "PARENT_STUDENT", " +919876543210 ");
    const b = hashAuthBucketKey("school-1", "PARENT_STUDENT", "+919876543210");
    expect(a).toBe(b);
  });

  it("produces different bucket keys for different schools (tenant isolation)", () => {
    const a = hashAuthBucketKey("school-1", "PARENT_STUDENT", "+919876543210");
    const b = hashAuthBucketKey("school-2", "PARENT_STUDENT", "+919876543210");
    expect(a).not.toBe(b);
  });

  it("never returns the raw identifier", () => {
    const hash = hashAuthBucketKey("school-1", "TEACHER", "teacher@example.com");
    expect(hash).not.toContain("teacher@example.com");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashIp and hashSessionIdentifier are deterministic SHA-256 hex", () => {
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"));
    expect(hashSessionIdentifier("abc")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("FixedClock (PART 30 — testable time)", () => {
  it("does not advance on its own", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00Z"));
    const t1 = clock.now();
    const t2 = clock.now();
    expect(t1.getTime()).toBe(t2.getTime());
  });

  it("advances only when explicitly told to", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00Z"));
    clock.advanceMs(60_000);
    expect(clock.now().getTime()).toBe(new Date("2026-01-01T00:01:00Z").getTime());
  });
});

describe("job payload fingerprint (PART 13)", () => {
  it("is stable regardless of key ordering", () => {
    const a = computePayloadFingerprint({ schoolId: "s1", sections: [{ classId: "c1", sectionId: "sec1" }] });
    const b = computePayloadFingerprint({ sections: [{ sectionId: "sec1", classId: "c1" }], schoolId: "s1" });
    expect(a).toBe(b);
  });

  it("differs for a genuinely different payload", () => {
    const a = computePayloadFingerprint({ schoolId: "s1", sections: [{ classId: "c1", sectionId: "sec1" }] });
    const b = computePayloadFingerprint({ schoolId: "s1", sections: [{ classId: "c1", sectionId: "sec2" }] });
    expect(a).not.toBe(b);
  });

  it("array element order is preserved as semantically meaningful", () => {
    const a = computePayloadFingerprint({ sections: [{ sectionId: "A" }, { sectionId: "B" }] });
    const b = computePayloadFingerprint({ sections: [{ sectionId: "B" }, { sectionId: "A" }] });
    expect(a).not.toBe(b);
  });
});

describe("file retention expiry derivation (PART 17-19)", () => {
  it("homework attachment expires due date + 7 days", () => {
    const due = new Date("2026-07-06T00:00:00Z");
    const result = homeworkAttachmentRetention(due);
    expect(result.retentionPolicy).toBe("EXPIRING");
    expect(result.expiresAt?.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("homework submission expires due date + 30 days", () => {
    const due = new Date("2026-07-06T00:00:00Z");
    const result = homeworkSubmissionRetention(due);
    expect(result.expiresAt?.toISOString().slice(0, 10)).toBe("2026-08-05");
  });

  it("student import source: success gets a 3-day window", () => {
    const completedAt = new Date("2026-07-06T00:00:00Z");
    const result = studentImportSourceRetention("COMPLETED", completedAt);
    expect(result.expiresAt?.toISOString().slice(0, 10)).toBe("2026-07-09");
  });

  it("student import source: failure gets a longer 7-day troubleshooting window", () => {
    const completedAt = new Date("2026-07-06T00:00:00Z");
    const result = studentImportSourceRetention("FAILED", completedAt);
    expect(result.expiresAt?.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("payment proofs never expire (LONG_TERM)", () => {
    expect(PAYMENT_PROOF_RETENTION.retentionPolicy).toBe("LONG_TERM");
    expect(PAYMENT_PROOF_RETENTION.expiresAt).toBeNull();
  });

  it("report-card assets / branding images are REFERENCE_MANAGED, never age-expired", () => {
    expect(REFERENCE_MANAGED_RETENTION.retentionPolicy).toBe("REFERENCE_MANAGED");
    expect(REFERENCE_MANAGED_RETENTION.expiresAt).toBeNull();
  });
});

describe("rate-limit / auth response contract (PART 12)", () => {
  it("rateLimitedResponse returns 429 with RATE_LIMITED code and Retry-After", async () => {
    const res = rateLimitedResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfterSeconds).toBe(42);
  });

  it("authLockResponse uses AUTH_COOLDOWN_ACTIVE for short cooldowns and AUTH_TEMPORARILY_LOCKED for long locks", async () => {
    const short = await authLockResponse(60).json();
    const long = await authLockResponse(21600).json();
    expect(short.code).toBe("AUTH_COOLDOWN_ACTIVE");
    expect(long.code).toBe("AUTH_TEMPORARILY_LOCKED");
  });

  it("newLoginLimitResponse returns NEW_LOGIN_LIMIT_REACHED", async () => {
    const res = newLoginLimitResponse(3600);
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.code).toBe("NEW_LOGIN_LIMIT_REACHED");
  });

  it("genericInvalidCredentialsResponse never distinguishes no-account vs wrong-password", async () => {
    const res = genericInvalidCredentialsResponse();
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.code).toBe("INVALID_CREDENTIALS");
    expect(JSON.stringify(body)).not.toMatch(/no.?account/i);
  });
});
