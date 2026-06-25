import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool } from "@/lib/tenant";
import { rankReplacementTeachers } from "@/lib/teacher-ranking";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject");
  const excludeTeacherId = searchParams.get("excludeTeacherId") || undefined;

  const recommendations = await rankReplacementTeachers(schoolId, subject, excludeTeacherId);
  return NextResponse.json(recommendations.slice(0, 5));
}
