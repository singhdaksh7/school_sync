import { NextRequest, NextResponse } from "next/server";
import { hostnameFromHeaders, resolveTenantBranding } from "@/lib/school-resolver";

function requestHostname(req: NextRequest) {
  return hostnameFromHeaders(req.headers);
}

export async function GET(req: NextRequest) {
  const branding = await resolveTenantBranding(requestHostname(req));
  return NextResponse.json(branding);
}
