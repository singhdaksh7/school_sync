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
      include: {
        section: true,
      },
    });

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    // Fetch timetable for student's section
    const timetable = await prisma.timetableSlot.findMany({
      where: {
        sectionId: student.sectionId,
      },
      include: {
        teacher: true,
      },
      orderBy: [
        { dayOfWeek: "asc" },
        { period: "asc" },
      ],
    });

    return NextResponse.json({ timetable });
  } catch (error) {
    console.error("Error fetching timetable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
