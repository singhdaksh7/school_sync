/**
 * Pure helpers for student login resolution — kept free of Prisma/bcrypt so the
 * disambiguation logic (the fix for the sibling / shared-phone / cross-school
 * admission-number collision) can be unit-tested directly.
 */

export type StudentAuthMatch = "none" | "ok" | "ambiguous";

/**
 * Given the students whose password verified, decide the outcome:
 *   - 0 matches          → "none"       (wrong credentials)
 *   - exactly 1          → "ok"         (log this student in)
 *   - >1 DISTINCT rows   → "ambiguous"  (same admission number across schools;
 *                                        need school context to disambiguate)
 *
 * The previous implementation silently returned null on >1, which surfaced as a
 * confusing "invalid credentials" for legitimate users. Making the states
 * explicit lets the route ask the user to use their school's portal link.
 */
export function classifyStudentMatches<T extends { id: string }>(validStudents: T[]): {
  status: StudentAuthMatch;
  student?: T;
} {
  const distinct = new Map<string, T>();
  for (const s of validStudents) distinct.set(s.id, s);

  if (distinct.size === 0) return { status: "none" };
  if (distinct.size === 1) return { status: "ok", student: [...distinct.values()][0] };
  return { status: "ambiguous" };
}
