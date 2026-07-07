import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { allStudentsBelongToSchool } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
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
  const date = new Date(dateParam + "T00:00:00.000Z");

  const records = await prisma.attendance.findMany({
    where: { schoolId: teacher.schoolId, sectionId: teacher.mentorSectionId, date, type: "STUDENT" },
  });
  return NextResponse.json(records);
}

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
    const { date: dateParam, records } = await req.json();
    const date = new Date(dateParam + "T00:00:00.000Z");
    const submitted = records as { id: string; status: string }[];
    if (!(await allStudentsBelongToSchool(submitted.map((r) => r.id), teacher.schoolId, teacher.mentorSectionId))) {
      return NextResponse.json({ error: "One or more students are not in your mentor section" }, { status: 400 });
    }

    await Promise.all(
      submitted.map((r) =>
        prisma.attendance.upsert({
          where: { date_studentId: { date, studentId: r.id } },
          create: {
            date,
            type: "STUDENT",
            status: r.status as "PRESENT" | "ABSENT" | "LATE",
            studentId: r.id,
            sectionId: teacher.mentorSectionId!,
            schoolId: teacher.schoolId,
            markedById: userId,
          },
          update: { status: r.status as "PRESENT" | "ABSENT" | "LATE" },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Teacher attendance POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
