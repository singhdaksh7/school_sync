import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";

export async function GET(req: NextRequest) {
  try {
    const studentId = req.nextUrl.searchParams.get("studentId");

    if (!studentId) {
      return NextResponse.json(
        { error: "Missing studentId" },
        { status: 400 }
      );
    }

    const auth = await getAuthenticatedGuardian(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        schoolId: auth.guardian.schoolId,
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
        schoolId: auth.guardian.schoolId,
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
