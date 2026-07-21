import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/driver-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(req: NextRequest) {
  const authed = await getAuthenticatedDriver(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const featureDenied = await requireSchoolFeature(authed.driver.schoolId, "TRANSPORT");
  if (featureDenied) return featureDenied;

  const rateLimited = await enforceActorRateLimit({ schoolId: authed.driver.schoolId, actorType: "DRIVER", actorId: authed.driver.id }, "STANDARD_READ");
  if (rateLimited) return rateLimited;

  return NextResponse.json({
    driver: {
      id: authed.driver.id,
      name: authed.driver.name,
      phone: authed.driver.phone,
      email: authed.driver.email,
    },
    school: { id: authed.driver.school.id, slug: authed.driver.school.slug },
  });
}
