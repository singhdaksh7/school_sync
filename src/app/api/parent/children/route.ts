import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyParentToken } from "@/lib/parent-auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized" },
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

    // Fetch all students with parent name matching the user's name
    const children = await prisma.student.findMany({
      where: {
        parentName: decoded.name,
        schoolId: decoded.schoolId,
      },
      include: {
        section: {
          include: {
            class: true,
          },
        },
      },
    });

    return NextResponse.json({ children });
  } catch (error) {
    console.error("Error fetching children:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
