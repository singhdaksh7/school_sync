import { describe, it, expect } from "vitest";
import { classifyStudentMatches } from "@/lib/student-login";

describe("student login disambiguation (sibling / shared-phone regression)", () => {
  it("returns 'none' when nothing matched", () => {
    expect(classifyStudentMatches([]).status).toBe("none");
  });

  it("returns 'ok' for a single matched student", () => {
    const res = classifyStudentMatches([{ id: "s1" }]);
    expect(res.status).toBe("ok");
    expect(res.student?.id).toBe("s1");
  });

  it("does NOT flag one student who matched via both parent phones as ambiguous", () => {
    // The same student row matched (e.g. father AND mother phone equal) must
    // dedupe to a single student — the old code's length>1 wrongly failed this.
    const res = classifyStudentMatches([{ id: "s1" }, { id: "s1" }]);
    expect(res.status).toBe("ok");
    expect(res.student?.id).toBe("s1");
  });

  it("flags genuinely distinct students (same admission no across schools) as ambiguous", () => {
    const res = classifyStudentMatches([{ id: "s1" }, { id: "s2" }]);
    expect(res.status).toBe("ambiguous");
    expect(res.student).toBeUndefined();
  });
});
