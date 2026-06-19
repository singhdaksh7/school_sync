import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";

export async function GET(req: Request) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const student = await prisma.student.findFirst({
      where: { id: auth.studentId, schoolId: auth.schoolId },
      select: {
        id: true,
        name: true,
        rollNo: true,
        admissionNo: true,
        email: true,
        phone: true,
        parentName: true,
        parentPhone: true,
        createdAt: true,
        section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        school: { select: { id: true, name: true, slug: true, logoUrl: true } },
      },
    });
    if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(student);
  } catch (error) {
    console.error("Error fetching student profile:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
