import { NextResponse } from "next/server";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { listCatalogue } from "@/lib/library/catalogue";

export async function GET(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.schoolId, "LIBRARY");
  if (denied) return denied;

  const url = new URL(req.url);
  return NextResponse.json(await listCatalogue(auth.schoolId, url.searchParams));
}
