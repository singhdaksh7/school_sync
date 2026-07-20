/**
 * Reconciles a Weekly Period Requirements row list against a freshly-loaded
 * set of valid Master Subject ids for the (possibly just-changed) class or
 * section — any row still pointing at a subjectId that's no longer valid is
 * cleared rather than silently carried over and re-submitted stale. Rows that
 * already exist server-side (have an `id`) but resolve to no subjectId are
 * legacy/unmapped and are left untouched (never invented a subjectId for
 * them, never dropped).
 */
export interface ReconcilableRequirement {
  id?: string;
  subjectId: string | null;
  subjectName: string;
}

export function clearStaleSubjectSelections<T extends ReconcilableRequirement>(requirements: T[], validSubjectIds: ReadonlySet<string>): T[] {
  return requirements.map((r) => {
    if (r.subjectId && !validSubjectIds.has(r.subjectId) && !r.id) {
      return { ...r, subjectId: null, subjectName: "" };
    }
    return r;
  });
}
