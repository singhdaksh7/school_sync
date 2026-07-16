import { NextRequest, NextResponse } from "next/server";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { markAnnouncementRead, AnnouncementAuthError } from "@/lib/announcements";

export async function POST(req: NextRequest, { params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params;
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await markAnnouncementRead(auth.schoolId, announcementId, {
      actorType: "STUDENT",
      actorId: auth.studentId,
      sectionId: auth.sectionId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Mark student announcement read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
