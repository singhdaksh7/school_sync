import { NextRequest, NextResponse } from "next/server";
import { brandingForSchool, resolveSchool } from "@/lib/school-resolver";

function requestHostname(req: NextRequest) {
  return req.headers.get("x-forwarded-host") || req.headers.get("host");
}

export async function GET(req: NextRequest) {
  const school = await resolveSchool(requestHostname(req));
  return NextResponse.json(brandingForSchool(school));
}
