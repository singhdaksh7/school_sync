import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reportCardInclude, serializeReportCard } from "@/lib/report-cards";
import { canAccessSchool } from "@/lib/tenant";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const examSchemeId = searchParams.get("examSchemeId");
  const status = searchParams.get("status");

  const reportCards = await prisma.reportCard.findMany({
    where: {
      schoolId,
      ...(sectionId ? { sectionId } : {}),
      ...(examSchemeId ? { examSchemeId } : {}),
      ...(status === "DRAFT" || status === "PUBLISHED" ? { status } : {}),
    },
    include: reportCardInclude,
    orderBy: [{ status: "asc" }, { student: { rollNo: "asc" } }],
  });

  return NextResponse.json({ reportCards: reportCards.map(serializeReportCard) });
}
