import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, sessionRole } from "@/lib/tenant";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (
    !(role === "SCHOOL_OWNER" || role === "SCHOOL_ADMIN") ||
    !(await canAccessSchool(schoolId, session.user.id))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { name: true } } },
  });

  return NextResponse.json({ invoices });
}
