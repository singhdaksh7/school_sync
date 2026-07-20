import { describe, expect, it } from "vitest";
import { compareStudentsByRollNumber, sortStudentsByRollNumber, type RollNumberOrderable } from "@/lib/student-ordering";

function student(overrides: Partial<RollNumberOrderable> & { id: string }): RollNumberOrderable {
  return { rollNo: null, name: "", admissionNo: null, ...overrides };
}

function rollOrder(students: RollNumberOrderable[]): (string | null | undefined)[] {
  return sortStudentsByRollNumber(students).map((s) => s.rollNo);
}

describe("compareStudentsByRollNumber / sortStudentsByRollNumber — canonical roll-number ordering", () => {
  it("orders 1, 2, 3, 10, 11, 20 numerically ascending (never 1, 10, 11, 2, 20, 3)", () => {
    const students = ["20", "1", "11", "3", "10", "2"].map((rollNo, i) => student({ id: `s${i}`, rollNo }));
    expect(rollOrder(students)).toEqual(["1", "2", "3", "10", "11", "20"]);
  });

  it("leading-zero variants sort by their numeric value", () => {
    const students = [student({ id: "a", rollNo: "007" }), student({ id: "b", rollNo: "2" }), student({ id: "c", rollNo: "010" })];
    expect(rollOrder(students)).toEqual(["2", "007", "010"]);
  });

  it("equal numeric values from different textual roll numbers use the original text as a stable tie-breaker", () => {
    // "07" and "007" both equal numeric value 7 but are different strings (allowed since
    // rollNo is unique per-string, not per numeric value) — comparison must be deterministic.
    const students = [student({ id: "a", rollNo: "07" }), student({ id: "b", rollNo: "007" })];
    const sorted = sortStudentsByRollNumber(students);
    expect(sorted.map((s) => s.rollNo)).toEqual(["007", "07"]); // "007" < "07" lexicographically
    // Running it again (or reversed input) must produce the identical order — proves stability, not luck.
    const reversed = sortStudentsByRollNumber([students[1], students[0]]);
    expect(reversed.map((s) => s.rollNo)).toEqual(["007", "07"]);
  });

  it("non-numeric roll numbers sort after all numeric ones", () => {
    const students = [student({ id: "a", rollNo: "A1" }), student({ id: "b", rollNo: "2" }), student({ id: "c", rollNo: "1" })];
    expect(rollOrder(students)).toEqual(["1", "2", "A1"]);
  });

  it("non-numeric roll numbers use case-insensitive natural ordering among themselves", () => {
    const students = ["R10", "r2", "R1"].map((rollNo, i) => student({ id: `s${i}`, rollNo }));
    expect(rollOrder(students)).toEqual(["R1", "r2", "R10"]);
  });

  it("null and empty roll numbers appear last, after both numeric and non-numeric values", () => {
    const students = [
      student({ id: "a", rollNo: null, name: "Zed" }),
      student({ id: "b", rollNo: "A1" }),
      student({ id: "c", rollNo: "" , name: "Amy" }),
      student({ id: "d", rollNo: "3" }),
    ];
    const sorted = sortStudentsByRollNumber(students);
    expect(sorted.slice(0, 2).map((s) => s.rollNo)).toEqual(["3", "A1"]);
    expect(sorted.slice(2).map((s) => s.id).sort()).toEqual(["a", "c"]);
  });

  it("within the null/empty bucket, falls back to name, then admissionNo, then id", () => {
    const students = [
      student({ id: "z", rollNo: null, name: "Beta", admissionNo: "AD2" }),
      student({ id: "a", rollNo: "", name: "Alpha", admissionNo: "AD1" }),
      student({ id: "m", rollNo: undefined, name: "Alpha", admissionNo: "AD0" }),
    ];
    const sorted = sortStudentsByRollNumber(students);
    expect(sorted.map((s) => s.id)).toEqual(["m", "a", "z"]); // Alpha/AD0 < Alpha/AD1 < Beta
  });

  it("duplicate numeric-equivalent roll numbers keep a deterministic order regardless of input order", () => {
    const a = student({ id: "a", rollNo: "5" });
    const b = student({ id: "b", rollNo: "05" });
    const forward = sortStudentsByRollNumber([a, b]).map((s) => s.id);
    const backward = sortStudentsByRollNumber([b, a]).map((s) => s.id);
    expect(forward).toEqual(backward);
  });

  it("never mutates the input array", () => {
    const students = [student({ id: "a", rollNo: "2" }), student({ id: "b", rollNo: "1" })];
    const original = [...students];
    sortStudentsByRollNumber(students);
    expect(students).toEqual(original);
  });

  it("compareStudentsByRollNumber is usable directly as an Array.prototype.sort comparator", () => {
    const students = [student({ id: "a", rollNo: "10" }), student({ id: "b", rollNo: "2" })];
    students.sort(compareStudentsByRollNumber);
    expect(students.map((s) => s.rollNo)).toEqual(["2", "10"]);
  });
});
