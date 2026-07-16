import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { canAccessSchool, hasPrismaErrorCode, sectionBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { getClientIp } from "@/lib/request-ip";
import { createStudentRecord } from "@/lib/student-creation";
import { backfillHomeworkStatusForStudent } from "@/lib/homework";
import { getStudentLimitInfo, withinStudentLimit, STUDENT_LIMIT_MESSAGE } from "@/lib/plan-limits";
import { parsePagination, paginated } from "@/lib/pagination";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

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
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  // A section/whole-school roster is needed in full by attendance and marks
  // entry (every student must be markable, not one page of them), so the
  // ceiling here is generous; the default stays small for the paginated
  // students-management table when no explicit limit is requested.
  const { skip, take, page, limit } = parsePagination(searchParams, { maxLimit: 500 });

  const where = { schoolId, ...(sectionId ? { sectionId } : {}) };
  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      include: { section: { include: { class: true } } },
      orderBy: [{ section: { class: { name: "asc" } } }, { rollNo: "asc" }],
      skip,
      take,
    }),
    prisma.student.count({ where }),
  ]);
  return NextResponse.json(paginated(students, total, { skip, take, page, limit }));
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    const data = schema.parse(body);
    if (!(await sectionBelongsToSchool(data.sectionId, schoolId))) {
      return NextResponse.json({ error: "Section not found in this school" }, { status: 400 });
    }

    const { maxStudents, currentCount } = await getStudentLimitInfo(schoolId);
    if (!withinStudentLimit(currentCount, 1, maxStudents)) {
      return NextResponse.json({ error: STUDENT_LIMIT_MESSAGE }, { status: 403 });
    }

    const student = await createStudentRecord(
      prisma,
      {
        name: data.name,
        admissionNo: data.admissionNo,
        rollNo: data.rollNo,
        email: data.email,
        phone: data.phone,
        fatherName: data.fatherName,
        fatherPhone: data.fatherPhone,
        motherName: data.motherName,
        motherPhone: data.motherPhone,
        sectionId: data.sectionId,
        schoolId,
      },
      { include: { section: { include: { class: true } } } }
    );
    await logAudit({ action: "STUDENT_CREATED", entityType: "Student", entityId: student.id, metadata: { name: student.name, rollNo: student.rollNo, admissionNo: student.admissionNo }, userId: session.user.id, schoolId, actorRole: sessionRole(session.user), ipAddress: getClientIp(req) });
    await backfillHomeworkStatusForStudent(student.id, schoolId, student.sectionId);
    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: duplicateFieldMessage(err) }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
