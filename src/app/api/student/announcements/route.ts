import { NextRequest, NextResponse } from "next/server";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { parsePagination } from "@/lib/pagination";
import { listAnnouncementsForStudent } from "@/lib/announcements";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const pagination = parsePagination(searchParams, { defaultLimit: 50 });
    const result = await listAnnouncementsForStudent(auth.schoolId, auth.studentId, auth.sectionId, pagination);

    // Legacy response shape (`announcements`) preserved for existing clients,
    // alongside the new paginated `data`/`pagination` envelope.
    return NextResponse.json({ announcements: result.data, pagination: result.pagination });
  } catch (error) {
    console.error("Error fetching student announcements:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
