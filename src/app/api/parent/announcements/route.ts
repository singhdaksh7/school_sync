import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { parsePagination } from "@/lib/pagination";
import { listAnnouncementsForGuardian } from "@/lib/announcements";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const pagination = parsePagination(searchParams, { defaultLimit: 50 });
    const result = await listAnnouncementsForGuardian(auth.guardian.schoolId, auth.guardian.id, pagination);

    // Legacy response shape (`announcements`) preserved for existing clients,
    // alongside the new paginated `data`/`pagination` envelope. Each item now
    // also carries `relevantStudents` so a guardian with multiple linked
    // students can see which student(s)/class made it relevant, without
    // exposing any other guardian's or student's data.
    return NextResponse.json({ announcements: result.data, pagination: result.pagination });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
