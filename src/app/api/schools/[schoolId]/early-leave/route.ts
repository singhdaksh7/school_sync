import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool } from "@/lib/tenant";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const status = statusParam === "PENDING" || statusParam === "APPROVED" || statusParam === "REJECTED" ? statusParam : null;

  const requests = await prisma.teacherEarlyLeaveRequest.findMany({
    where: { schoolId, ...(status ? { status } : {}) },
    include: {
      teacher: { select: { id: true, name: true, subject: true } },
      approvedBy: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { date: "desc" }],
  });

  return NextResponse.json(requests);
}
