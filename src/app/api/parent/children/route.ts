import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { sortStudentsByRollNumber } from "@/lib/student-ordering";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const children = await prisma.student.findMany({
      where: {
        schoolId: auth.guardian.schoolId,
        guardianLinks: {
          some: {
            guardianId: auth.guardian.id,
            schoolId: auth.guardian.schoolId,
          },
        },
      },
      include: {
        section: {
          include: {
            class: true,
          },
        },
      },
    });

    // Universal roll-number ordering (canonical comparator — see /lib/student-ordering)
    // — this query previously had no `orderBy` at all, so its result order was
    // undefined; a guardian's linked children are always few, so an in-memory
    // sort is safe.
    return NextResponse.json({ children: sortStudentsByRollNumber(children) });
  } catch (error) {
    console.error("Error fetching children:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
