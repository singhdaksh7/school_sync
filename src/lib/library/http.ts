import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { getMobileAuth } from "@/lib/mobile-auth";
import { DEFAULT_SCHOOL_TIMEZONE } from "@/lib/school-time";
import type { ServiceError } from "@/lib/library/service";

/**
 * Resolves the acting STAFF user (web session cookie OR mobile bearer JWT) for
 * a library staff route. Returns { userId, role } or null. Student bearer tokens
 * resolve to null here (they carry no userId and must use /api/student/library).
 */
export async function resolveLibraryStaffUser(req: Request): Promise<{ userId: string; role: string } | null> {
  const session = await auth();
  if (session?.user?.id) return { userId: session.user.id, role: sessionRole(session.user) ?? "" };

  const mobile = await getMobileAuth(req);
  if (mobile) {
    const role = mobile.decoded.role;
    let userId: string | undefined = mobile.decoded.userId;
    if (!userId && "teacher" in mobile && mobile.teacher) userId = mobile.teacher.userId ?? undefined;
    if (!userId && "user" in mobile && mobile.user) userId = mobile.user.id;
    if (userId) return { userId, role };
  }
  return null;
}

export function libraryServiceError(e: ServiceError): NextResponse {
  return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
}

export async function getSchoolTimezone(schoolId: string): Promise<string> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  return school?.timezone || DEFAULT_SCHOOL_TIMEZONE;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
