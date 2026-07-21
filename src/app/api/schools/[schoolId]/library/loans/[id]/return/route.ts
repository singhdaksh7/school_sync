import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryReturn } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, libraryServiceError, getSchoolTimezone, unauthorized } from "@/lib/library/http";
import { returnLoan } from "@/lib/library/service";

const schema = z.object({
  finalCondition: z.string().trim().max(200).optional(),
  copyOutcome: z.enum(["AVAILABLE", "LOST", "DAMAGED", "UNDER_REPAIR"]).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryReturn(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  let body: z.infer<typeof schema> = {};
  try {
    const raw = await req.text();
    body = raw ? schema.parse(JSON.parse(raw)) : {};
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const timezone = await getSchoolTimezone(schoolId);
  const result = await returnLoan({
    schoolId,
    loanId: id,
    actor: { userId: user.userId, role: user.role },
    timezone,
    finalCondition: body.finalCondition ?? null,
    copyOutcome: body.copyOutcome,
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
