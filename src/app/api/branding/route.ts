import { NextRequest, NextResponse } from "next/server";
import { brandingForSchool, hostnameFromHeaders, resolveSchool } from "@/lib/school-resolver";

function requestHostname(req: NextRequest) {
  return hostnameFromHeaders(req.headers);
}

export async function GET(req: NextRequest) {
  const school = await resolveSchool(requestHostname(req));
  return NextResponse.json(brandingForSchool(school));
}
