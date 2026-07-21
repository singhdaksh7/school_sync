import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { createCorrectionRequest } from "@/lib/attendance-corrections";
import { ATTENDANCE_STATUS_VALUES } from "@/lib/attendance-sessions";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

/** Only the mentor teacher's OWN correction requests for their own section — never another teacher's. */
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacher(teacherAuth.userId);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "ATTENDANCE");
  if (featureDenied) return featureDenied;

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "ATTENDANCE", "VIEW", { sectionId: teacher.mentorSectionId });
  if (denied) return denied;

  const requests = await prisma.attendanceCorrectionRequest.findMany({
    where: { schoolId: teacher.schoolId, sectionId: teacher.mentorSectionId, requestedById: teacher.id },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}

const createSchema = z
  .object({
    date: z.string(),
    reason: z.string().min(1, "A reason is required"),
    items: z
      .array(
        z
          .object({
            studentId: z.string(),
            requestedStatus: z.enum(ATTENDANCE_STATUS_VALUES as [string, ...string[]]),
          })
          .strict()
      )
      .min(1, "At least one student is required"),
  })
  .strict();

export async function POST(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacher(teacherAuth.userId);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "ATTENDANCE");
  if (featureDenied) return featureDenied;

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "ATTENDANCE", "EDIT", { sectionId: teacher.mentorSectionId });
  if (denied) return denied;

  try {
    const body = await req.json();
    const parsed = createSchema.parse(body);
    const date = new Date(parsed.date + "T00:00:00.000Z");

    const result = await createCorrectionRequest({
      schoolId: teacher.schoolId,
      sectionId: teacher.mentorSectionId,
      date,
      requestedById: teacher.id,
      requestedByUserId: teacherAuth.userId,
      reason: parsed.reason,
      items: parsed.items.map((i) => ({ studentId: i.studentId, requestedStatus: i.requestedStatus as "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE" })),
    });

    if (!result.ok) return NextResponse.json({ error: "Correction request rejected", reasonCode: result.code }, { status: 400 });
    return NextResponse.json({ success: true, correctionRequestId: result.correctionRequestId }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    console.error("Teacher attendance correction POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
