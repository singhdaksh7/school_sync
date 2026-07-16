import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { loadAttendanceRosterView, saveAttendanceDraft, ATTENDANCE_STATUS_VALUES } from "@/lib/attendance-sessions";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

function parseDateParam(dateParam: string) {
  return new Date(dateParam + "T00:00:00.000Z");
}

// getTeacherAuth (src/lib/mobile-auth.ts) accepts EITHER a NextAuth web
// Teacher session OR a bearer mobile Teacher JWT and resolves the same
// canonical {userId, teacherId, schoolId} either way — this is an
// authentication-transport change only; every feature gate, permission
// check, scope check, and business rule below is unchanged.
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacher(teacherAuth.userId);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "ATTENDANCE");
  if (featureDenied) return featureDenied;

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "ATTENDANCE", "VIEW", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
  const date = parseDateParam(dateParam);

  const view = await loadAttendanceRosterView(teacher.schoolId, teacher.mentorSectionId, date);
  return NextResponse.json(view);
}

// Client can only ever supply studentId + status per record — schoolId,
// sectionId, actor, and any session/audit field are always resolved
// server-side from the authenticated teacher, never trusted from the body.
const draftSchema = z
  .object({
    date: z.string(),
    records: z
      .array(
        z
          .object({
            id: z.string(),
            status: z.enum(ATTENDANCE_STATUS_VALUES as [string, ...string[]]),
          })
          .strict()
      )
      .max(500),
  })
  .strict();

/** Saves a DRAFT mark for each given student. Rejected (409) once the session is SUBMITTED — see /submit. */
export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = teacherAuth.userId;

  const teacher = await getTeacher(userId);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "ATTENDANCE");
  if (featureDenied) return featureDenied;

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "ATTENDANCE", "MARK", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;

  try {
    const body = await req.json();
    const parsed = draftSchema.parse(body);
    const date = parseDateParam(parsed.date);

    const result = await saveAttendanceDraft({
      schoolId: teacher.schoolId,
      sectionId: teacher.mentorSectionId,
      date,
      actorUserId: userId,
      actorRole: "TEACHER",
      records: parsed.records.map((r) => ({ studentId: r.id, status: r.status as "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE" })),
    });

    if (!result.ok) {
      const status = result.code === "SESSION_LOCKED" ? 409 : 400;
      return NextResponse.json({ error: "Attendance draft rejected", reasonCode: result.code }, { status });
    }

    return NextResponse.json({ success: true, sessionStatus: result.sessionStatus, recordCount: result.recordCount });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Teacher attendance POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
