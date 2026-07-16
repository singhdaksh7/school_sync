import { describe, it, expect } from "vitest";
import { assertLegalTransition, AdmissionTransitionError, isTerminalStatus } from "@/lib/admissions/transitions";
import { ADMISSION_STATUS_TRANSITIONS, TERMINAL_STATUSES, type AdmissionApplicationStatusValue } from "@/lib/admissions/constants";

const ALL_STATUSES = Object.keys(ADMISSION_STATUS_TRANSITIONS) as AdmissionApplicationStatusValue[];

describe("admissions status transition table", () => {
  it("allows every legal transition declared in the spec", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ADMISSION_STATUS_TRANSITIONS[from]) {
        const reason = ["WAITLISTED", "APPROVED", "REJECTED", "WITHDRAWN"].includes(to) ? "because" : undefined;
        expect(() => assertLegalTransition(from, to, reason)).not.toThrow();
      }
    }
  });

  it("rejects every transition NOT declared in the table", () => {
    for (const from of ALL_STATUSES) {
      const allowed = new Set(ADMISSION_STATUS_TRANSITIONS[from]);
      for (const to of ALL_STATUSES) {
        if (allowed.has(to)) continue;
        expect(() => assertLegalTransition(from, to, "reason")).toThrow(AdmissionTransitionError);
      }
    }
  });

  it("enforces terminal states have zero outgoing transitions", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(ADMISSION_STATUS_TRANSITIONS[status]).toEqual([]);
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  it("rejects any transition attempted from a terminal state with TERMINAL_STATE code", () => {
    for (const status of TERMINAL_STATUSES) {
      try {
        assertLegalTransition(status, "UNDER_REVIEW" as AdmissionApplicationStatusValue, "reason");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AdmissionTransitionError);
        expect((err as AdmissionTransitionError).code).toBe("TERMINAL_STATE");
      }
    }
  });

  it("requires a mandatory reason for decision transitions (WAITLISTED/APPROVED/REJECTED/WITHDRAWN)", () => {
    const decisionCases: [AdmissionApplicationStatusValue, AdmissionApplicationStatusValue][] = [
      ["UNDER_REVIEW", "WAITLISTED"],
      ["UNDER_REVIEW", "APPROVED"],
      ["UNDER_REVIEW", "REJECTED"],
      ["UNDER_REVIEW", "WITHDRAWN"],
    ];
    for (const [from, to] of decisionCases) {
      expect(() => assertLegalTransition(from, to, undefined)).toThrow(AdmissionTransitionError);
      expect(() => assertLegalTransition(from, to, "")).toThrow(AdmissionTransitionError);
      expect(() => assertLegalTransition(from, to, "   ")).toThrow(AdmissionTransitionError);
      expect(() => assertLegalTransition(from, to, "valid reason")).not.toThrow();
    }
  });

  it("does not require a reason for non-decision transitions", () => {
    expect(() => assertLegalTransition("SUBMITTED", "UNDER_REVIEW")).not.toThrow();
    expect(() => assertLegalTransition("DRAFT", "SUBMITTED")).not.toThrow();
  });

  it("matches the exact transition table from the spec", () => {
    expect(ADMISSION_STATUS_TRANSITIONS.DRAFT.sort()).toEqual(["SUBMITTED", "WITHDRAWN"].sort());
    expect(ADMISSION_STATUS_TRANSITIONS.SUBMITTED.sort()).toEqual(["DOCUMENTS_PENDING", "UNDER_REVIEW", "WITHDRAWN"].sort());
    expect(ADMISSION_STATUS_TRANSITIONS.UNDER_REVIEW.sort()).toEqual(
      ["APPROVED", "ASSESSMENT_SCHEDULED", "DOCUMENTS_PENDING", "INTERVIEW_SCHEDULED", "REJECTED", "WAITLISTED", "WITHDRAWN"].sort()
    );
    expect(ADMISSION_STATUS_TRANSITIONS.DOCUMENTS_PENDING.sort()).toEqual(["UNDER_REVIEW", "WITHDRAWN"].sort());
    expect(ADMISSION_STATUS_TRANSITIONS.INTERVIEW_SCHEDULED.sort()).toEqual(
      ["APPROVED", "REJECTED", "UNDER_REVIEW", "WAITLISTED", "WITHDRAWN"].sort()
    );
    expect(ADMISSION_STATUS_TRANSITIONS.ASSESSMENT_SCHEDULED.sort()).toEqual(
      ["APPROVED", "REJECTED", "UNDER_REVIEW", "WAITLISTED", "WITHDRAWN"].sort()
    );
    expect(ADMISSION_STATUS_TRANSITIONS.WAITLISTED.sort()).toEqual(["APPROVED", "REJECTED", "UNDER_REVIEW", "WITHDRAWN"].sort());
    expect(ADMISSION_STATUS_TRANSITIONS.APPROVED.sort()).toEqual(["ENROLLED", "WITHDRAWN"].sort());
    expect(ADMISSION_STATUS_TRANSITIONS.REJECTED).toEqual([]);
    expect(ADMISSION_STATUS_TRANSITIONS.WITHDRAWN).toEqual([]);
    expect(ADMISSION_STATUS_TRANSITIONS.ENROLLED).toEqual([]);
  });
});
