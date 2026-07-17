import { describe, it, expect } from "vitest";
import { assertLegalTransition, CertificateTransitionError, isTerminalStatus, isAlreadyInTargetState } from "@/lib/certificates/transitions";
import { CERTIFICATE_REQUEST_TRANSITIONS, TERMINAL_STATUSES, CERTIFICATE_REQUEST_STATUSES } from "@/lib/certificates/constants";

describe("assertLegalTransition", () => {
  it("allows every transition declared in the single source-of-truth map", () => {
    for (const [from, tos] of Object.entries(CERTIFICATE_REQUEST_TRANSITIONS)) {
      for (const to of tos) {
        expect(() => assertLegalTransition(from as never, to as never)).not.toThrow();
      }
    }
  });

  it("rejects every transition not declared in the map", () => {
    for (const from of CERTIFICATE_REQUEST_STATUSES) {
      const allowed = new Set(CERTIFICATE_REQUEST_TRANSITIONS[from]);
      for (const to of CERTIFICATE_REQUEST_STATUSES) {
        if (from === to || allowed.has(to)) continue;
        expect(() => assertLegalTransition(from, to)).toThrow(CertificateTransitionError);
      }
    }
  });

  it("throws TERMINAL_STATE for any transition attempted from a terminal status", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of CERTIFICATE_REQUEST_STATUSES) {
        try {
          assertLegalTransition(from, to);
          expect.fail(`expected ${from} -> ${to} to throw`);
        } catch (err) {
          expect(err).toBeInstanceOf(CertificateTransitionError);
          expect((err as CertificateTransitionError).code).toBe("TERMINAL_STATE");
        }
      }
    }
  });

  it("PENDING can reach UNDER_REVIEW, REJECTED, or CANCELLED but nothing else", () => {
    expect(() => assertLegalTransition("PENDING", "UNDER_REVIEW")).not.toThrow();
    expect(() => assertLegalTransition("PENDING", "REJECTED")).not.toThrow();
    expect(() => assertLegalTransition("PENDING", "CANCELLED")).not.toThrow();
    expect(() => assertLegalTransition("PENDING", "APPROVED")).toThrow();
    expect(() => assertLegalTransition("PENDING", "ISSUED")).toThrow();
  });

  it("only APPROVED can reach ISSUED, and only ISSUED can reach REVOKED", () => {
    expect(() => assertLegalTransition("APPROVED", "ISSUED")).not.toThrow();
    expect(() => assertLegalTransition("UNDER_REVIEW", "ISSUED")).toThrow();
    expect(() => assertLegalTransition("ISSUED", "REVOKED")).not.toThrow();
    expect(() => assertLegalTransition("APPROVED", "REVOKED")).toThrow();
  });
});

describe("isTerminalStatus", () => {
  it("matches TERMINAL_STATUSES exactly", () => {
    for (const status of CERTIFICATE_REQUEST_STATUSES) {
      expect(isTerminalStatus(status)).toBe(TERMINAL_STATUSES.has(status));
    }
  });
});

describe("isAlreadyInTargetState", () => {
  it("is true only when current equals target", () => {
    expect(isAlreadyInTargetState("ISSUED", "ISSUED")).toBe(true);
    expect(isAlreadyInTargetState("APPROVED", "ISSUED")).toBe(false);
  });
});
