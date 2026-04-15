import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function canAccess(schoolId: string, userId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { admins: { select: { id: true } } },
  });
  if (!school) return false;
  return school.ownerId === userId || school.admins.some((a) => a.id === userId);
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccess(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const leaveRequestId = searchParams.get("leaveRequestId");
  const dateStr = searchParams.get("date");

  const arrangements = await prisma.arrangement.findMany({
    where: {
      schoolId,
      ...(leaveRequestId ? { leaveRequestId } : {}),
      ...(dateStr ? { date: new Date(dateStr) } : {}),
    },
    include: {
      absentTeacher: { select: { name: true } },
      substituteTeacher: { select: { name: true } },
      section: { include: { class: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { period: "asc" }],
  });
  return NextResponse.json(arrangements);
}
