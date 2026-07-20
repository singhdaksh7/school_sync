import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryFineWaive } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, libraryServiceError, unauthorized } from "@/lib/library/http";
import { waiveFine } from "@/lib/library/service";

// Mandatory reason. Any client-supplied fine amount is ignored — the waived
// amount is always recomputed server-side (full waiver of the outstanding fine).
const schema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryFineWaive(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await waiveFine({
    schoolId,
    loanId: id,
    reason: body.reason,
    actor: { userId: user.userId, role: user.role },
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
