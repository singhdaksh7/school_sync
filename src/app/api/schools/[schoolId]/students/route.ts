import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { canAccessSchool, hasPrismaErrorCode, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { getClientIp } from "@/lib/request-ip";
import { buildStudentPasswordHashes } from "@/lib/student-credentials";

function duplicateFieldMessage(err: unknown) {
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  if (fields.includes("admissionNo")) return "Admission number already exists in this school";
  if (fields.includes("rollNo")) return "Roll number already exists";
  return "A student with these details already exists";
}

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

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "STUDENTS", "VIEW");
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");

  const students = await prisma.student.findMany({
    where: { schoolId, ...(sectionId ? { sectionId } : {}) },
    include: { section: { include: { class: true } } },
    orderBy: [{ section: { class: { name: "asc" } } }, { rollNo: "asc" }],
  });
  return NextResponse.json(students);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = schema.parse(body);
    if (!(await sectionBelongsToSchool(data.sectionId, schoolId))) {
      return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
    }

    const { fatherPhoneHash, motherPhoneHash } = await buildStudentPasswordHashes(data.fatherPhone, data.motherPhone);

    const student = await prisma.student.create({
      data: {
        name: data.name,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo,
        email: data.email || null,
        phone: data.phone || null,
        fatherName: data.fatherName || null,
        fatherPhone: data.fatherPhone || null,
        fatherPhoneHash,
        motherName: data.motherName || null,
        motherPhone: data.motherPhone || null,
        motherPhoneHash,
        sectionId: data.sectionId,
        schoolId,
      },
      include: { section: { include: { class: true } } },
    });
    await logAudit({ action: "STUDENT_CREATED", entityType: "Student", entityId: student.id, metadata: { name: student.name, rollNo: student.rollNo, admissionNo: student.admissionNo }, userId: session.user.id, schoolId, actorRole: sessionRole(session.user), ipAddress: getClientIp(req) });
    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: duplicateFieldMessage(err) }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
