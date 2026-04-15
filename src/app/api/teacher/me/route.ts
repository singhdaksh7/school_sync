import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await prisma.teacher.findUnique({
    where: { userId: session.user.id },
    include: {
      school: { select: { id: true, name: true, slug: true } },
      mentorSection: {
        include: {
          class: { select: { id: true, name: true } },
          students: {
            orderBy: { rollNo: "asc" },
            select: { id: true, name: true, rollNo: true },
          },
        },
      },
    },
  });

  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  return NextResponse.json(teacher);
}
