import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyParentToken } from "@/lib/parent-auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const studentId = req.nextUrl.searchParams.get("studentId");

    if (!token || !studentId) {
      return NextResponse.json(
        { error: "Unauthorized or missing studentId" },
        { status: 401 }
      );
    }

    const decoded = verifyParentToken(token);
    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 401 }
      );
    }

    // Verify student belongs to this parent
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        parentName: decoded.name,
        schoolId: decoded.schoolId,
      },
    });

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    // Fetch attendance for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendance = await prisma.attendance.findMany({
      where: {
        studentId,
        date: { gte: thirtyDaysAgo },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({ attendance });
  } catch (error) {
    console.error("Error fetching attendance:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
