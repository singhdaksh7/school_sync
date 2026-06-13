import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch announcements for the school
    const announcements = await prisma.announcement.findMany({
      where: {
        schoolId: auth.guardian.schoolId,
      },
      include: {
        createdBy: {
          select: {
            name: true,
            role: true,
          },
        },
      },
      orderBy: {
        publishedAt: "desc",
      },
      take: 50,
    });

    return NextResponse.json({ announcements });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
