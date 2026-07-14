import { describe, it, expect } from "vitest";
import {
  isSchoolAdminReadRole,
  isSchoolAdminWriteRole,
  statusIsBlocked,
  schoolBlockedMessage,
} from "@/lib/school-access";

describe("school-access role policy", () => {
  it("admits owner/admin/VP to generic admin READ, but never a teacher", () => {
    expect(isSchoolAdminReadRole("SCHOOL_OWNER")).toBe(true);
    expect(isSchoolAdminReadRole("SCHOOL_ADMIN")).toBe(true);
    expect(isSchoolAdminReadRole("VICE_PRINCIPAL")).toBe(true);
    expect(isSchoolAdminReadRole("TEACHER")).toBe(false);
    expect(isSchoolAdminReadRole("STUDENT")).toBe(false);
    expect(isSchoolAdminReadRole("FOUNDER")).toBe(false);
    expect(isSchoolAdminReadRole(undefined)).toBe(false);
  });

  it("admits only owner/admin to generic WRITE (VP is read-only)", () => {
    expect(isSchoolAdminWriteRole("SCHOOL_OWNER")).toBe(true);
    expect(isSchoolAdminWriteRole("SCHOOL_ADMIN")).toBe(true);
    expect(isSchoolAdminWriteRole("VICE_PRINCIPAL")).toBe(false);
    expect(isSchoolAdminWriteRole("TEACHER")).toBe(false);
  });
});

describe("school lifecycle status", () => {
  it("blocks SUSPENDED and EXPIRED, allows ACTIVE and TRIAL", () => {
    expect(statusIsBlocked("SUSPENDED")).toBe(true);
    expect(statusIsBlocked("EXPIRED")).toBe(true);
    expect(statusIsBlocked("ACTIVE")).toBe(false);
    expect(statusIsBlocked("TRIAL")).toBe(false);
    expect(statusIsBlocked(null)).toBe(false);
  });

  it("uses a generic, billing-detail-free message", () => {
    expect(schoolBlockedMessage("EXPIRED")).toBe("School access has expired");
    expect(schoolBlockedMessage("SUSPENDED")).toBe("School access is suspended");
    expect(schoolBlockedMessage("EXPIRED")).not.toMatch(/invoice|plan|amount|₹/i);
  });

  it("blocks every deletion-lifecycle status the instant it's scheduled, not only once the purge starts", () => {
    expect(statusIsBlocked("PENDING_DELETION")).toBe(true);
    expect(statusIsBlocked("DELETING")).toBe(true);
    expect(statusIsBlocked("DELETION_FAILED")).toBe(true);
    expect(statusIsBlocked("DELETED")).toBe(true);
  });

  it("uses a generic message for deletion-lifecycle statuses too — no hint that deletion is in progress leaks to blocked users", () => {
    for (const status of ["PENDING_DELETION", "DELETING", "DELETION_FAILED", "DELETED"]) {
      expect(schoolBlockedMessage(status)).toBe("This school is no longer available");
    }
  });
});
