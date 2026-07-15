import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { markAnnouncementRead, AnnouncementAuthError } from "@/lib/announcements";

export async function POST(req: NextRequest, { params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params;
  const auth = await getAuthenticatedGuardian(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await markAnnouncementRead(auth.guardian.schoolId, announcementId, {
      actorType: "GUARDIAN",
      actorId: auth.guardian.id,
      guardianId: auth.guardian.id,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Mark parent announcement read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
