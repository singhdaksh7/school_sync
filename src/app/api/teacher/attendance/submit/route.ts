import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { submitAttendanceSession } from "@/lib/attendance-sessions";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

const schema = z.object({ date: z.string() }).strict();

/** Locks the section's attendance for `date` — requires every eligible student to have exactly one status already saved as a draft. */
export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacher(teacherAuth.userId);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "ATTENDANCE");
  if (featureDenied) return featureDenied;

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "ATTENDANCE", "SUBMIT", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;

  try {
    const body = await req.json();
    const { date: dateParam } = schema.parse(body);
    const date = new Date(dateParam + "T00:00:00.000Z");

    const result = await submitAttendanceSession({
      schoolId: teacher.schoolId,
      sectionId: teacher.mentorSectionId,
      date,
      actorUserId: teacherAuth.userId,
      actorRole: "TEACHER",
    });

    if (!result.ok) {
      const status = result.code === "ALREADY_SUBMITTED" ? 409 : 400;
      return NextResponse.json(
        {
          error: "Attendance submission rejected",
          reasonCode: result.code,
          ...(result.code === "INCOMPLETE_ROSTER"
            ? { missingStudentIds: result.missingStudentIds, extraStudentIds: result.extraStudentIds }
            : {}),
        },
        { status }
      );
    }

    return NextResponse.json({ success: true, submittedCount: result.submittedCount });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Teacher attendance submit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
