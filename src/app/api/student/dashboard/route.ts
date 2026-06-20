import { NextResponse } from "next/server";
import { getStudentDashboardData } from "@/lib/student-dashboard";
import { getStudentAuth } from "@/lib/student-mobile-auth";

export async function GET(req: Request) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = await getStudentDashboardData(auth.studentId, auth.schoolId);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching student dashboard:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
