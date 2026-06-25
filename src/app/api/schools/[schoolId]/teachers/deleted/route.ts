import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teachers = await prisma.teacher.findMany({
    where: { schoolId, isDeleted: true },
    include: {
      deletedBy: { select: { id: true, name: true } },
    },
    orderBy: { deletedAt: "desc" },
  });

  return NextResponse.json(teachers);
}
