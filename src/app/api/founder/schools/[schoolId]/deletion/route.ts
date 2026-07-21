import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFounderSession } from "@/lib/founder";
import { getSchoolDeletionImpact, scheduleSchoolDeletion, cancelSchoolDeletion } from "@/lib/school-deletion";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

const errorStatus: Record<string, number> = {
  NOT_FOUND: 404,
  REAUTH_FAILED: 401,
  CONFIRMATION_MISMATCH: 400,
  INVALID_STATE: 409,
};

/** Danger Zone status + impact preview (sanitized: aggregate counts only). */
export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { schoolId } = await params;
  const impact = await getSchoolDeletionImpact(schoolId);
  if (!impact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(impact);
}

const scheduleSchema = z.object({
  password: z.string().min(1, "Password is required"),
  confirmedNameOrSlug: z.string().min(1, "Type the school name or slug to confirm"),
});

/** Schedules deletion — requires fresh password re-auth + typed name/slug confirmation (see ticket §5). */
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limit = await rateLimit(`schoolDeletionSchedule:${session.user.id}`, RATE_LIMIT_POLICIES.schoolDeletionSchedule, { failClosed: true });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  const { schoolId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const result = await scheduleSchoolDeletion({
    schoolId,
    founderId: session.user.id,
    password: parsed.data.password,
    confirmedNameOrSlug: parsed.data.confirmedNameOrSlug,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: errorStatus[result.code] ?? 400 });

  return NextResponse.json({ school: { id: result.school.id, status: result.school.status }, scheduledFor: result.scheduledFor });
}

const cancelSchema = z.object({ password: z.string().min(1, "Password is required") });

/** Cancels/restores a scheduled deletion — requires fresh password re-auth. Only possible while still PENDING_DELETION. */
export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limit = await rateLimit(`schoolDeletionCancel:${session.user.id}`, RATE_LIMIT_POLICIES.schoolDeletionCancel, { failClosed: true });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  const { schoolId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const result = await cancelSchoolDeletion({ schoolId, founderId: session.user.id, password: parsed.data.password });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: errorStatus[result.code] ?? 400 });

  return NextResponse.json({ school: { id: result.school.id, status: result.school.status } });
}
