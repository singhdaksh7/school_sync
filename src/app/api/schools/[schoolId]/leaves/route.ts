import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canAccessSchool, studentBelongsToSchool, teacherBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "LEAVE", "VIEW");
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as "STUDENT" | "TEACHER" | null;
  const status = searchParams.get("status") as "PENDING" | "APPROVED" | "REJECTED" | null;

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      schoolId,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      student: { select: { name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
      teacher: { select: { name: true, subject: true } },
      reviewedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(leaves);
}

const createSchema = z.object({
  type: z.enum(["STUDENT", "TEACHER"]),
  reason: z.string().min(1),
  fromDate: z.string(),
  toDate: z.string(),
  studentId: z.string().optional(),
  teacherId: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    if (data.type === "STUDENT" && !data.studentId)
      return NextResponse.json({ error: "studentId required for STUDENT leave" }, { status: 400 });
    if (data.type === "TEACHER" && !data.teacherId)
      return NextResponse.json({ error: "teacherId required for TEACHER leave" }, { status: 400 });
    if (data.studentId && !(await studentBelongsToSchool(data.studentId, schoolId))) {
      return NextResponse.json({ error: "Student not found in this school" }, { status: 400 });
    }
    if (data.teacherId && !(await teacherBelongsToSchool(data.teacherId, schoolId))) {
      return NextResponse.json({ error: "Teacher not found in this school" }, { status: 400 });
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        type: data.type,
        reason: data.reason,
        fromDate: new Date(data.fromDate),
        toDate: new Date(data.toDate),
        studentId: data.studentId || null,
        teacherId: data.teacherId || null,
        schoolId,
      },
      include: {
        student: { select: { name: true, rollNo: true } },
        teacher: { select: { name: true } },
      },
    });
    return NextResponse.json(leave, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
