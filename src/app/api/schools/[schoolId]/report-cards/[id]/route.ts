import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { canAccessSchool } from "@/lib/tenant";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ schoolId: string; id: string }> }
) {
  const { schoolId, id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const card = await prisma.reportCard.findFirst({
    where: { id, schoolId },
    include: reportCardInclude,
  });
  if (!card) return NextResponse.json({ error: "Report card not found" }, { status: 404 });

  return NextResponse.json({ reportCard: serializeReportCard(card) });
}
