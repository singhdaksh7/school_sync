/**
 * Canonical "universal roll-number ordering" — the single shared
 * implementation every class/section-scoped student list must use so the
 * rule never drifts between screens: 1, 2, 3, 10, 11, 20 (never 1, 10, 11, 2,
 * 20, 3).
 *
 * Ordering:
 *   1. Fully-numeric rollNo values, ascending by numeric value (leading
 *      zeros compare by their numeric value: "007" and "7" are both 7).
 *   2. Equal numeric values tie-break on the original rollNo text (stable,
 *      deterministic — not meaningful beyond being consistent).
 *   3. Non-numeric rollNo values, after all numeric ones, ordered by
 *      case-insensitive natural sort (token-splits digit/non-digit runs so
 *      "R2" sorts before "R10").
 *   4. Null/empty rollNo values last.
 *   5. Final tie-breakers (when rollNo alone doesn't decide, i.e. within the
 *      null/empty bucket, or as an extra safety net): name, admissionNo, id.
 */

import { Prisma } from "@/generated/prisma/client";

export interface RollNumberOrderable {
  rollNo?: string | null;
  name?: string | null;
  admissionNo?: string | null;
  id: string;
}

const NUMERIC_ROLL_NO = /^\d+$/;
const TOKEN_PATTERN = /\d+|\D+/g;

type Token = number | string;

function tokenize(value: string): Token[] {
  const matches = value.match(TOKEN_PATTERN);
  if (!matches) return [];
  return matches.map((token) => (NUMERIC_ROLL_NO.test(token) ? Number(token) : token.toLowerCase()));
}

function compareNatural(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  const len = Math.max(aTokens.length, bTokens.length);
  for (let i = 0; i < len; i++) {
    const at = aTokens[i];
    const bt = bTokens[i];
    if (at === undefined) return -1;
    if (bt === undefined) return 1;
    if (typeof at === "number" && typeof bt === "number") {
      if (at !== bt) return at - bt;
      continue;
    }
    const as = String(at);
    const bs = String(bt);
    if (as !== bs) return as < bs ? -1 : 1;
  }
  return 0;
}

type RollBucket = 0 | 1 | 2; // 0 = numeric, 1 = non-numeric, 2 = null/empty

function classifyRollNo(rollNo: string | null | undefined): RollBucket {
  if (rollNo == null || rollNo.trim() === "") return 2;
  return NUMERIC_ROLL_NO.test(rollNo.trim()) ? 0 : 1;
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Stable comparator — pass directly to Array.prototype.sort. */
export function compareStudentsByRollNumber<T extends RollNumberOrderable>(a: T, b: T): number {
  const bucketA = classifyRollNo(a.rollNo);
  const bucketB = classifyRollNo(b.rollNo);
  if (bucketA !== bucketB) return bucketA - bucketB;

  if (bucketA === 0) {
    const numA = Number(a.rollNo!.trim());
    const numB = Number(b.rollNo!.trim());
    if (numA !== numB) return numA - numB;
    if (a.rollNo !== b.rollNo) return compareStrings(a.rollNo!, b.rollNo!);
  } else if (bucketA === 1) {
    const cmp = compareNatural(a.rollNo!.trim(), b.rollNo!.trim());
    if (cmp !== 0) return cmp;
  }

  const nameA = (a.name ?? "").toLowerCase();
  const nameB = (b.name ?? "").toLowerCase();
  if (nameA !== nameB) return compareStrings(nameA, nameB);

  const admA = a.admissionNo ?? "";
  const admB = b.admissionNo ?? "";
  if (admA !== admB) return compareStrings(admA, admB);

  return compareStrings(a.id, b.id);
}

/** Returns a new, canonically-ordered array — never mutates the input. */
export function sortStudentsByRollNumber<T extends RollNumberOrderable>(students: T[]): T[] {
  return [...students].sort(compareStudentsByRollNumber);
}

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Roll-number ORDER BY expression, qualified by a caller-chosen table alias
 * (a fixed developer-supplied identifier — e.g. `"s"` for `Student s` — never
 * derived from request input, and validated against a strict identifier
 * pattern as a guard rail regardless). For the rare case a route must
 * paginate students in raw SQL and can't sort-then-slice in application code
 * (e.g. a join against Section/Class where an unqualified "id"/"name" column
 * reference would be ambiguous). Contains no interpolated request values —
 * callers still parameterize every WHERE-clause value (schoolId, classId,
 * sectionId, cursor, search) via Prisma.sql tagged-template placeholders,
 * never string concatenation, when composing this alongside their own
 * filters.
 *
 * Mirrors compareStudentsByRollNumber's bucket rules exactly, except the
 * non-numeric bucket falls back to a plain case-insensitive string sort
 * (true digit-run natural sort has no simple safe SQL expression) — numeric
 * roll numbers, the overwhelming common case, still sort exactly right.
 */
export function buildRollNumberOrderByExprSql(alias: string): Prisma.Sql {
  if (!SQL_IDENTIFIER_PATTERN.test(alias)) {
    throw new Error(`buildRollNumberOrderByExprSql: invalid SQL identifier "${alias}"`);
  }
  const rollNo = Prisma.raw(`"${alias}"."rollNo"`);
  const name = Prisma.raw(`"${alias}"."name"`);
  const admissionNo = Prisma.raw(`"${alias}"."admissionNo"`);
  const id = Prisma.raw(`"${alias}"."id"`);
  return Prisma.sql`
    (CASE
      WHEN ${rollNo} IS NULL OR trim(${rollNo}) = '' THEN 2
      WHEN ${rollNo} ~ '^[0-9]+$' THEN 0
      ELSE 1
    END) ASC,
    (CASE WHEN ${rollNo} ~ '^[0-9]+$' THEN ${rollNo}::bigint END) ASC,
    (CASE WHEN ${rollNo} ~ '^[0-9]+$' THEN NULL ELSE lower(${rollNo}) END) ASC,
    ${rollNo} ASC,
    lower(${name}) ASC,
    ${admissionNo} ASC,
    ${id} ASC
  `;
}
