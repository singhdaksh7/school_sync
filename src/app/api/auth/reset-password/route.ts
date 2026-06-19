import { NextResponse } from "next/server";
import { z } from "zod";
import { validatePasswordResetToken, consumePasswordResetToken } from "@/lib/password-reset";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

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

    return NextResponse.json({ success: true, role: result.role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    console.error("Reset-password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
