import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { markAnnouncementRead, AnnouncementAuthError } from "@/lib/announcements";

export async function POST(_req: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params;
  const teacherAuth = await getTeacherAuth(_req);
  if (!teacherAuth?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await markAnnouncementRead(teacherAuth.schoolId, announcementId, {
      actorType: "TEACHER",
      actorId: teacherAuth.teacherId,
      teacherUserId: teacherAuth.userId,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Mark teacher announcement read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
