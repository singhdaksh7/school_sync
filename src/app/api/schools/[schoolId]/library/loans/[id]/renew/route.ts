import { NextResponse } from "next/server";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRenew } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, libraryServiceError, unauthorized } from "@/lib/library/http";
import { renewLoan } from "@/lib/library/service";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryRenew(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const result = await renewLoan({
    schoolId,
    loanId: id,
    actor: { userId: user.userId, role: user.role },
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
