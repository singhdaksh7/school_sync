import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // The Announcement model has no audience/section targeting, so students see
    // school-level announcements only (scoped strictly to their own school).
    const announcements = await prisma.announcement.findMany({
      where: { schoolId: auth.schoolId },
      include: { createdBy: { select: { name: true, role: true } } },
      orderBy: { publishedAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ announcements });
  } catch (error) {
    console.error("Error fetching student announcements:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
