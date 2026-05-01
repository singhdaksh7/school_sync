import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getTeacher(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacher(session.user.id);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
  const date = new Date(dateParam + "T00:00:00.000Z");

  const records = await prisma.attendance.findMany({
    where: { sectionId: teacher.mentorSectionId, date, type: "STUDENT" },
  });
  return NextResponse.json(records);
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacher(userId);
  if (!teacher?.mentorSectionId) return NextResponse.json({ error: "No mentor section assigned" }, { status: 400 });

  try {
    const { date: dateParam, records } = await req.json();
    const date = new Date(dateParam + "T00:00:00.000Z");

    await Promise.all(
      (records as { id: string; status: string }[]).map((r) =>
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
