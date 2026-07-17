import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { validateStudentLeaveDateRange, createStudentLeaveRequest } from "@/lib/student-leave-rules";

/**
 * Lists leave requests for the guardian's linked children only. `studentId`
 * narrows to one child (after an ownership check); omitted, it returns every
 * linked child's leave requests — supports a parent with multiple children.
 * An unrelated/cross-school studentId gets the SAME 404 as "not found" (the
 * repo's non-enumerating convention — see guardianCanAccessStudent callers
 * in /api/parent/attendance and /api/parent/homework) so a guardian can never
 * distinguish "wrong id" from "not your child".
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "ATTENDANCE");
    if (featureDenied) return featureDenied;

    const studentId = req.nextUrl.searchParams.get("studentId");
    if (studentId && !(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const linkedStudents = await prisma.student.findMany({
      where: {
        schoolId: auth.guardian.schoolId,
        ...(studentId ? { id: studentId } : {}),
        guardianLinks: { some: { guardianId: auth.guardian.id, schoolId: auth.guardian.schoolId } },
      },
      select: { id: true, name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } },
    });
    const studentIds = linkedStudents.map((s) => s.id);
    const studentById = new Map(linkedStudents.map((s) => [s.id, s]));

    const leaves = studentIds.length
      ? await prisma.leaveRequest.findMany({
          where: { studentId: { in: studentIds }, schoolId: auth.guardian.schoolId, type: "STUDENT" },
          include: { reviewedBy: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [];

    const withStudent = leaves.map((leave) => ({ ...leave, student: studentById.get(leave.studentId!) ?? null }));

    return NextResponse.json({ leaves: withStudent, children: linkedStudents });
  } catch (error) {
    console.error("Error fetching parent leave requests:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Strict: only studentId/leaveType/reason/fromDate/toDate may ever be
// supplied — schoolId, guardianId, status, reviewedById, or any other
// identity/audit/status field is rejected outright, never silently dropped.
const createSchema = z
  .object({
    studentId: z.string().min(1),
    leaveType: z.string().min(1, "Leave type is required"),
    reason: z.string().min(1, "Reason is required"),
    fromDate: z.string(),
    toDate: z.string(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "ATTENDANCE");
    if (featureDenied) return featureDenied;

    const body = await req.json();
    const parsed = createSchema.parse(body);

    // School and child ownership are ALWAYS resolved server-side from the
    // authenticated guardian — the client only ever supplies a studentId,
    // which is verified against the real StudentGuardian link before use.
    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, parsed.studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const validated = validateStudentLeaveDateRange(parsed.fromDate, parsed.toDate);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const leave = await createStudentLeaveRequest({
      schoolId: auth.guardian.schoolId,
      studentId: parsed.studentId,
      leaveType: parsed.leaveType,
      reason: parsed.reason,
      from: validated.from,
      to: validated.to,
    });

    return NextResponse.json(leave, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    console.error("Error creating parent leave request:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
