import { NextRequest, NextResponse } from "next/server";
import { getMobileAuth } from "@/lib/mobile-auth";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";

export async function GET(req: NextRequest) {
  const mobile = await getMobileAuth(req);
  if (mobile) {
    if (mobile.decoded.role === "STUDENT" && "student" in mobile) {
      return NextResponse.json({ role: "STUDENT", student: mobile.student, school: mobile.school });
    }

    return NextResponse.json({
      role: mobile.decoded.role,
      user: "user" in mobile ? mobile.user : {
        id: mobile.decoded.userId,
        name: mobile.decoded.name,
        email: mobile.decoded.email,
        role: mobile.decoded.role,
        schoolId: mobile.decoded.schoolId,
        teacherId: mobile.decoded.teacherId,
      },
      school: mobile.school,
    });
  }

  const parent = await getAuthenticatedGuardian(req);
  if (parent) {
    return NextResponse.json({
      role: "PARENT",
      user: {
        id: parent.guardian.id,
        name: parent.guardian.name,
        email: parent.guardian.email,
        phone: parent.guardian.phone,
        role: "PARENT",
        schoolId: parent.guardian.schoolId,
        schoolSlug: parent.decoded.schoolSlug,
      },
      school: { id: parent.guardian.schoolId, slug: parent.decoded.schoolSlug },
    });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
