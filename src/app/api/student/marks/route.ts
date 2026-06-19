import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gradeForPercentage } from "@/lib/report-cards";
import { getStudentAuth } from "@/lib/student-mobile-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const results = await prisma.examResult.findMany({
      where: {
        studentId: auth.studentId,
        student: { schoolId: auth.schoolId },
        exam: { scheme: { schoolId: auth.schoolId } },
      },
      include: {
        exam: { include: { scheme: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const marks = results.map((result) => {
      const percentage = result.exam.maxMarks > 0 ? (result.marks / result.exam.maxMarks) * 100 : 0;
      return {
        id: result.id,
        marks: result.marks,
        grade: gradeForPercentage(percentage),
        exam: {
          id: result.exam.id,
          name: result.exam.name,
          maxMarks: result.exam.maxMarks,
          scheme: result.exam.scheme,
        },
      };
    });

    return NextResponse.json({ marks });
  } catch (error) {
    console.error("Error fetching student marks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
