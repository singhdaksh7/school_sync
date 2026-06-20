import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";

// Schema stores dayOfWeek as 1=Mon ... 6=Sat (7=Sun if used). JS getDay() is
// 0=Sun ... 6=Sat, so Sunday maps to 7.
function todayDayOfWeek() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 7 : jsDay;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const timetable = await prisma.timetableSlot.findMany({
      where: {
        schoolId: auth.schoolId,
        sectionId: auth.sectionId,
      },
      include: {
        teacher: { select: { id: true, name: true } },
        section: { include: { class: { select: { name: true } } } },
      },
      orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
    });

    const dayOfWeek = todayDayOfWeek();
    const today = timetable.filter((slot) => slot.dayOfWeek === dayOfWeek);

    return NextResponse.json({ timetable, today, dayOfWeek });
  } catch (error) {
    console.error("Error fetching student timetable:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
