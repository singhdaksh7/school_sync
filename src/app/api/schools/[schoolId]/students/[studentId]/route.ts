import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { canAccessSchool, hasPrismaErrorCode, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { getClientIp } from "@/lib/request-ip";
import { buildStudentPasswordHashes } from "@/lib/student-credentials";

const schema = z
  .object({
    name: z.string().min(2),
    admissionNo: z.string().min(1, "Admission number is required"),
    rollNo: z.string().min(1),
    sectionId: z.string().min(1),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    fatherName: z.string().optional(),
    fatherPhone: z.string().optional(),
    motherName: z.string().optional(),
    motherPhone: z.string().optional(),
  })
  .refine((data) => Boolean(data.fatherPhone?.trim() || data.motherPhone?.trim()), {
    message: "Father Phone or Mother Phone is required so the student can log in",
    path: ["fatherPhone"],
  });

function duplicateFieldMessage(err: unknown) {
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  if (fields.includes("admissionNo")) return "Admission number already exists in this school";
  if (fields.includes("rollNo")) return "Roll number already exists";
  return "A student with these details already exists";
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string; studentId: string }> }) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "STUDENTS", "VIEW");
  if (!access.ok) return access.response;

  const student = await prisma.student.findUnique({
    where: { id: studentId, schoolId },
    include: {
      section: { include: { class: true } },
      attendances: { orderBy: { date: "desc" }, take: 60 },
      examResults: {
        include: { exam: { include: { scheme: true } } },
        orderBy: [{ exam: { scheme: { name: "asc" } } }, { exam: { order: "asc" } }],
      },
    },
  });

  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(student);
}

export async function PUT(req: Request, { params }: { params: Promise<{ schoolId: string; studentId: string }> }) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "STUDENTS", "UPDATE");
  if (!access.ok) return access.response;

  try {
    const body = await req.json();
    const data = schema.parse(body);
    if (!(await sectionBelongsToSchool(data.sectionId, schoolId))) {
      return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
    }

    const existing = await prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { fatherPhoneHash, motherPhoneHash } = await buildStudentPasswordHashes(data.fatherPhone, data.motherPhone);

    await prisma.student.updateMany({
      where: { id: studentId, schoolId },
      data: {
        name: data.name, admissionNo: data.admissionNo, rollNo: data.rollNo, sectionId: data.sectionId,
        email: data.email || null, phone: data.phone || null,
        fatherName: data.fatherName || null, fatherPhone: data.fatherPhone || null, fatherPhoneHash,
        motherName: data.motherName || null, motherPhone: data.motherPhone || null, motherPhoneHash,
      },
    });
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId },
      include: { section: { include: { class: true } } },
    });
    await logAudit({ action: "STUDENT_UPDATED", entityType: "Student", entityId: studentId, metadata: { name: data.name }, userId: session.user.id, schoolId, actorRole: sessionRole(session.user), ipAddress: getClientIp(req) });
    return NextResponse.json(student);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: duplicateFieldMessage(err) }, { status: 400 });
    console.error("Update student error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; studentId: string }> }) {
  const { schoolId, studentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const student = await prisma.student.findFirst({ where: { id: studentId, schoolId }, select: { name: true } });
    if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.student.deleteMany({ where: { id: studentId, schoolId } });
    await logAudit({ action: "STUDENT_DELETED", entityType: "Student", entityId: studentId, metadata: { name: student.name }, userId: session.user.id, schoolId, actorRole: sessionRole(session.user), ipAddress: getClientIp(req) });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete student error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
