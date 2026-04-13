import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

async function verify(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a: { id: string }) => a.id === userId);
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await verify(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const type = searchParams.get("type");
  const sectionId = searchParams.get("sectionId");

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  const records = await prisma.attendance.findMany({
    where: {
      schoolId,
      date: dateObj,
      ...(type ? { type: type as any } : {}),
      ...(sectionId ? { sectionId } : {}),
    },
    include: { student: true, teacher: true },
  });
  return NextResponse.json(records);
}

const markSchema = z.object({
  date: z.string(),
  type: z.enum(["STUDENT", "TEACHER"]),
  records: z.array(z.object({
    id: z.string(),
    status: z.enum(["PRESENT", "ABSENT", "LATE"]),
    sectionId: z.string().optional(),
  })),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  if (!(await verify(schoolId, userId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { date, type, records } = markSchema.parse(body);
    const dateObj = new Date(date);
    dateObj.setHours(0, 0, 0, 0);

    const upserts = records.map((r) =>
      prisma.attendance.upsert({
        where: type === "STUDENT"
          ? { date_studentId: { date: dateObj, studentId: r.id } }
          : { date_teacherId: { date: dateObj, teacherId: r.id } },
        update: { status: r.status },
        create: {
          date: dateObj,
          type,
          status: r.status,
          ...(type === "STUDENT" ? { studentId: r.id, sectionId: r.sectionId } : { teacherId: r.id }),
          schoolId,
          markedById: userId,
        },
      })
    );

    await prisma.$transaction(upserts);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
