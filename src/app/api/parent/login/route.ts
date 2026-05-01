import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateParentToken } from "@/lib/parent-auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Student email and phone number are required" },
        { status: 400 }
      );
    }

    // Look up student by their email
    const student = await prisma.student.findFirst({
      where: { email: email.trim().toLowerCase() },
      include: {
        school: { select: { id: true, slug: true } },
      },
    });

    if (!student || !student.phone) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Phone number is the password — compare after stripping whitespace
    if (student.phone.replace(/\s+/g, "") !== password.replace(/\s+/g, "")) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (!student.parentName) {
      return NextResponse.json(
        { error: "No parent name linked to this student. Please contact the school." },
        { status: 403 }
      );
    }

    const token = generateParentToken({
      userId: student.id,
      email: student.email ?? "",
      name: student.parentName,
      role: "PARENT",
      schoolId: student.schoolId,
      schoolSlug: student.school.slug,
    });

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: student.id,
        name: student.parentName,
        email: student.email,
        role: "PARENT",
        schoolId: student.schoolId,
        schoolSlug: student.school.slug,
      },
    });
  } catch (error) {
    console.error("Parent login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
