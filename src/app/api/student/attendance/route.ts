import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentMobileAuth } from "@/lib/student-mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentMobileAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendance = await prisma.attendance.findMany({
      where: {
        studentId: auth.studentId,
        schoolId: auth.schoolId,
        type: "STUDENT",
        date: { gte: thirtyDaysAgo },
      },
      orderBy: { date: "desc" },
    });

    let present = 0;
    let absent = 0;
    let late = 0;
    for (const record of attendance) {
      if (record.status === "PRESENT") present += 1;
      else if (record.status === "ABSENT") absent += 1;
      else if (record.status === "LATE") late += 1;
    }
    const total = attendance.length;
    // LATE is counted as attended, mirroring report-card attendance maths.
    const percentage = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

    return NextResponse.json({
      attendance,
      summary: { present, absent, late, total, percentage },
    });
  } catch (error) {
    console.error("Error fetching student attendance:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
