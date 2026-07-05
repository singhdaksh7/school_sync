/**
 * Teacher Operations Head & Automatic Delegation (Phase 3) — delegated
 * audit-metadata helper (PART 23/24). Every operational mutation performed
 * via effective-head delegation must record enough structured context to
 * distinguish Primary vs Alternate action after the fact — built ONCE here
 * rather than duplicated at every mutation call site.
 *
 * Never includes a session token, bearer token, or password. Only
 * meaningful MUTATIONS carry this metadata — reads are never audited here
 * (unchanged from the existing AuditLog usage across the codebase).
 *
 * Actor identity (PART 24): `AuditLog.userId` already identifies the acting
 * User row (a teacher's linked User, from Teacher.userId — confirmed present
 * for every mobile/session teacher actor). `actorTeacherId` is additional
 * metadata, not a schema change, so the Teacher identity is never lost
 * alongside the User identity AuditLog already requires.
 */

import type { OperationalAuthorizationContext } from "@/lib/operational-authorization";

export interface DelegatedAuditMetadata {
  operationalRole: "TEACHER_OPERATIONS";
  authorizationSource: "TEACHER_OPERATIONS_EFFECTIVE";
  actorTeacherId: string;
  delegated: boolean;
  effectiveAssignmentId: string | null;
  effectivePriority: number | null;
  primaryTeacherId: string | null;
  resolutionReasonCode: string;
}

/** Builds the standard delegated-action audit metadata block from a resolved operational authorization context. */
export function buildDelegatedAuditMetadata(actorTeacherId: string, operational: OperationalAuthorizationContext): DelegatedAuditMetadata {
  return {
    operationalRole: "TEACHER_OPERATIONS",
    authorizationSource: "TEACHER_OPERATIONS_EFFECTIVE",
    actorTeacherId,
    delegated: operational.delegated,
    effectiveAssignmentId: operational.effectiveAssignmentId,
    effectivePriority: operational.priority,
    primaryTeacherId: operational.primaryTeacherId,
    resolutionReasonCode: operational.reasonCode,
  };
}
