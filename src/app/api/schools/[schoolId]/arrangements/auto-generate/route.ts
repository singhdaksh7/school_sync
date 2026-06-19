import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { autoGenerateArrangementsForDate } from "@/lib/arrangements";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

const bodySchema = z.object({
  date: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Body is optional — default to today when no date is supplied.
    const raw = await req.json().catch(() => ({}));
    const { date } = bodySchema.parse(raw ?? {});

    const target = date ? new Date(date) : new Date();
    if (Number.isNaN(target.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const result = await autoGenerateArrangementsForDate(schoolId, target);

    await logAudit({
      action: "ARRANGEMENTS_AUTO_GENERATED",
      entityType: "Arrangement",
      metadata: result as unknown as Record<string, unknown>,
      userId: session.user.id,
      schoolId,
      actorRole: role,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
