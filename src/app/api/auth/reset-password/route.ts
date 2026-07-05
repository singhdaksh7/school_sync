import { NextResponse } from "next/server";
import { z } from "zod";
import { validatePasswordResetToken, consumePasswordResetToken } from "@/lib/password-reset";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { prisma } from "@/lib/prisma";
import { revokeAllSessionsForActor } from "@/lib/auth-sessions";
import { systemClock } from "@/lib/clock";

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8).regex(/[A-Za-z]/).regex(/[0-9]/),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ valid: false });

  const result = await validatePasswordResetToken(token);
  return NextResponse.json({ valid: Boolean(result), role: result?.role ?? null });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, password } = schema.parse(body);

    const result = await consumePasswordResetToken(token, password);
    if (!result) {
      return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    }

    await logAudit({
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "User",
      entityId: result.userId,
      userId: result.userId,
      actorRole: result.role,
      ipAddress: getClientIp(req),
    });

    // A password reset revokes any existing mobile sessions for this actor
    // (PART 7/29) — the old credential could have been compromised, so a
    // session issued under it should not silently keep working.
    const now = systemClock.now();
    if (result.role === "TEACHER") {
      const teacher = await prisma.teacher.findFirst({ where: { userId: result.userId, isDeleted: false }, select: { id: true, schoolId: true } });
      if (teacher) {
        await revokeAllSessionsForActor(
          { schoolId: teacher.schoolId, actorType: "TEACHER", userId: result.userId, teacherId: teacher.id },
          "PASSWORD_RESET",
          now
        );
      }
    } else if (["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"].includes(result.role)) {
      const user = await prisma.user.findUnique({ where: { id: result.userId }, select: { schoolId: true, ownedSchool: { select: { id: true } } } });
      const schoolId = user?.ownedSchool?.id ?? user?.schoolId ?? null;
      if (schoolId) {
        await revokeAllSessionsForActor({ schoolId, actorType: "ADMIN_STAFF", userId: result.userId }, "PASSWORD_RESET", now);
      }
    }

    return NextResponse.json({ success: true, role: result.role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    console.error("Reset-password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
