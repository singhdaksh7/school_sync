import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: vi.fn(), findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
    teacherRoleAssignment: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    student: { findFirst: vi.fn() },
    feeStructure: { findFirst: vi.fn() },
    examScheme: { findFirst: vi.fn() },
    section: { findFirst: vi.fn() },
    studentGuardian: { findFirst: vi.fn() },
    backgroundJob: { findFirst: vi.fn() },
    storedFile: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import {
  teacherBelongsToSchool,
  studentBelongsToSchool,
  feeStructureBelongsToSchool,
  examSchemeBelongsToSchool,
  sectionBelongsToSchool,
} from "@/lib/tenant";
import { guardianCanAccessStudent } from "@/lib/parent-auth";
import { getJobForSchool } from "@/lib/jobs";

const p = prisma as unknown as {
  school: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findFirst: ReturnType<typeof vi.fn> };
  teacherRoleAssignment: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  student: { findFirst: ReturnType<typeof vi.fn> };
  feeStructure: { findFirst: ReturnType<typeof vi.fn> };
  examScheme: { findFirst: ReturnType<typeof vi.fn> };
  section: { findFirst: ReturnType<typeof vi.fn> };
  studentGuardian: { findFirst: ReturnType<typeof vi.fn> };
  backgroundJob: { findFirst: ReturnType<typeof vi.fn> };
  storedFile: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

// ── Teacher RBAC matrix (C6) — exercised through the real requireSchoolAccess ─
describe("requireSchoolAccess — teacher RBAC matrix", () => {
  const ACTIVE_SCHOOL = { status: "ACTIVE" };

  it("allows the school owner/admin regardless of any teacher permission state", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue({ role: "SCHOOL_ADMIN", schoolId: "s1" });
    const result = await requireSchoolAccess("s1", "admin-1", "SCHOOL_ADMIN", "HOMEWORK", "VIEW");
    expect(result.ok).toBe(true);
    expect(p.teacher.findFirst).not.toHaveBeenCalled();
  });

  it("allows a teacher with NO custom role assignments (legacy unrestricted access)", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue(null); // not an admin/owner
    p.teacher.findFirst.mockResolvedValue({ id: "t1", schoolId: "s1" });
    p.teacherRoleAssignment.findMany.mockResolvedValue([]); // getTeacherScope: no assignments
    p.teacherRoleAssignment.count.mockResolvedValue(0); // teacherHasAnyRoleAssignment: none
    const result = await requireSchoolAccess("s1", "teacher-user-1", "TEACHER", "HOMEWORK", "VIEW");
    expect(result.ok).toBe(true);
  });

  it("denies a teacher with a role assignment that lacks the required permission", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue(null);
    p.teacher.findFirst.mockResolvedValue({ id: "t1", schoolId: "s1" });
    p.teacherRoleAssignment.count.mockResolvedValue(1); // has an assignment
    p.teacherRoleAssignment.findMany.mockResolvedValue([{ classIds: [], sectionIds: [], role: { permissions: [] } }]);
    p.teacherRoleAssignment.findFirst.mockResolvedValue(null); // no matching permission row
    const result = await requireSchoolAccess("s1", "teacher-user-1", "TEACHER", "HOMEWORK", "CREATE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows a teacher whose assigned role grants the permission and target is in scope", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue(null);
    p.teacher.findFirst.mockResolvedValue({ id: "t1", schoolId: "s1" });
    p.teacherRoleAssignment.count.mockResolvedValue(1);
    p.teacherRoleAssignment.findMany.mockResolvedValue([{ classIds: [], sectionIds: ["sec-1"], role: { permissions: [] } }]);
    p.teacherRoleAssignment.findFirst.mockResolvedValue({ id: "assignment-1" }); // permission matched
    const result = await requireSchoolAccess("s1", "teacher-user-1", "TEACHER", "HOMEWORK", "CREATE", { sectionId: "sec-1" });
    expect(result.ok).toBe(true);
  });

  it("denies a permission-holding teacher acting OUTSIDE their assigned section/class scope", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue(null);
    p.teacher.findFirst.mockResolvedValue({ id: "t1", schoolId: "s1" });
    p.teacherRoleAssignment.count.mockResolvedValue(1);
    p.teacherRoleAssignment.findMany.mockResolvedValue([{ classIds: [], sectionIds: ["sec-1"], role: { permissions: [] } }]);
    // First findFirst call resolves the specific action permission, second (MANAGE_ALL check) resolves none.
    p.teacherRoleAssignment.findFirst.mockResolvedValueOnce({ id: "assignment-1" }).mockResolvedValueOnce(null);
    const result = await requireSchoolAccess("s1", "teacher-user-1", "TEACHER", "HOMEWORK", "CREATE", { sectionId: "sec-OTHER" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("denies a soft-deleted teacher", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue(null);
    p.teacher.findFirst.mockResolvedValue(null); // isDeleted:false filter excludes them
    const result = await requireSchoolAccess("s1", "deleted-teacher-user", "TEACHER", "HOMEWORK", "VIEW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("denies a teacher who belongs to a DIFFERENT school than the one being accessed", async () => {
    p.school.findUnique.mockResolvedValue(ACTIVE_SCHOOL);
    p.user.findUnique.mockResolvedValue(null);
    p.teacher.findFirst.mockResolvedValue({ id: "t-other", schoolId: "school-b" }); // real teacher, wrong school
    const result = await requireSchoolAccess("school-a", "teacher-from-b", "TEACHER", "HOMEWORK", "VIEW");
    expect(result.ok).toBe(false);
  });

  it("SUSPENDED school lifecycle denies access before RBAC is even evaluated", async () => {
    p.school.findUnique.mockResolvedValue({ status: "SUSPENDED" });
    const result = await requireSchoolAccess("s1", "teacher-user-1", "TEACHER", "HOMEWORK", "VIEW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    // Lifecycle gate short-circuits — RBAC/teacher lookups never run.
    expect(p.teacher.findFirst).not.toHaveBeenCalled();
  });
});

// ── Feature flag precedence (C5/C6): disabled feature beats an RBAC ALLOW ────
describe("feature-disabled precedence over RBAC", () => {
  it("a disabled module feature blocks the request even though RBAC would allow it", async () => {
    // This mirrors real route composition: `requireSchoolFeature` is checked
    // first; only if it returns null does RBAC run at all.
    (prisma as unknown as { schoolFeatureFlag: { findUnique: ReturnType<typeof vi.fn> } }).schoolFeatureFlag = {
      findUnique: vi.fn().mockResolvedValue({ enabled: false }),
    };
    const featureDenied = await requireSchoolFeature("s1", "HOMEWORK");
    expect(featureDenied).not.toBeNull();
    expect(featureDenied!.status).toBe(403);
    // RBAC (requireSchoolAccess) is never reached by a real route in this case.
  });
});

// ── Cross-tenant isolation matrix (C2) — representative "belongsToSchool" helpers ─
describe("tenant isolation matrix — School A actor cannot touch a School B resource id", () => {
  it("teacherBelongsToSchool: denies a teacher id that belongs to a different school", async () => {
    p.teacher.findFirst.mockResolvedValue(null); // real DB: where{id, schoolId} excludes cross-tenant rows
    expect(await teacherBelongsToSchool("teacher-in-school-b", "school-a")).toBe(false);
    expect(p.teacher.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "teacher-in-school-b", schoolId: "school-a" }) })
    );
  });

  it("studentBelongsToSchool: denies a student id that belongs to a different school", async () => {
    p.student.findFirst.mockResolvedValue(null);
    expect(await studentBelongsToSchool("student-in-school-b", "school-a")).toBe(false);
  });

  it("feeStructureBelongsToSchool: denies a fee structure id from another school", async () => {
    p.feeStructure.findFirst.mockResolvedValue(null);
    expect(await feeStructureBelongsToSchool("fee-in-school-b", "school-a")).toBe(false);
  });

  it("examSchemeBelongsToSchool: denies an exam scheme id from another school", async () => {
    p.examScheme.findFirst.mockResolvedValue(null);
    expect(await examSchemeBelongsToSchool("scheme-in-school-b", "school-a")).toBe(false);
  });

  it("sectionBelongsToSchool: denies a section id from another school", async () => {
    p.section.findFirst.mockResolvedValue(null);
    expect(await sectionBelongsToSchool("section-in-school-b", "school-a")).toBe(false);
  });

  it("allows the matching resource for the correct school (positive control)", async () => {
    p.teacher.findFirst.mockResolvedValue({ id: "t1" });
    expect(await teacherBelongsToSchool("t1", "school-a")).toBe(true);
  });

  it("BackgroundJob lookup is tenant-scoped in its query (getJobForSchool)", async () => {
    p.backgroundJob.findFirst.mockResolvedValue(null);
    const result = await getJobForSchool("job-in-school-b", "school-a");
    expect(result).toBeNull();
    expect(p.backgroundJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-in-school-b", schoolId: "school-a" } })
    );
  });
});

// ── Parent/guardian ownership (C7) ───────────────────────────────────────────
describe("guardian-child ownership", () => {
  it("allows a guardian linked to the child", async () => {
    p.studentGuardian.findFirst.mockResolvedValue({ studentId: "child-1" });
    expect(await guardianCanAccessStudent("guardian-1", "s1", "child-1")).toBe(true);
  });

  it("denies a guardian NOT linked to the child (including a sibling's guardian without a link row)", async () => {
    p.studentGuardian.findFirst.mockResolvedValue(null);
    expect(await guardianCanAccessStudent("guardian-1", "s1", "someone-elses-child")).toBe(false);
  });

  it("scopes the link lookup to the guardian's own school (tenant isolation)", async () => {
    p.studentGuardian.findFirst.mockResolvedValue(null);
    await guardianCanAccessStudent("guardian-1", "school-a", "child-in-school-b");
    expect(p.studentGuardian.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ guardianId: "guardian-1", schoolId: "school-a", studentId: "child-in-school-b" }) })
    );
  });
});
