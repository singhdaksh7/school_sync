import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createPasswordResetToken } from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";

const schema = z.object({ email: z.string().email() });

const SENT_RESPONSE = {
  message: "Password reset instructions have been sent to your email.",
};

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Best-effort, per-process rate limit (same tradeoff as getClientIp: good enough
// on a long-running server, resets on cold start in serverless — no new infra for this).
const recentRequests = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(key: string) {
  const now = Date.now();
  const entry = recentRequests.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    recentRequests.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = schema.parse(body);
    const ipAddress = getClientIp(req);
    const rateLimitKey = `${ipAddress ?? "unknown"}:${email.toLowerCase()}`;

    if (isRateLimited(rateLimitKey)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
    if (!user) {
      return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
    }

    const rawToken = await createPasswordResetToken(user.id);
    const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    await sendPasswordResetEmail(user.email, resetUrl);
    await logAudit({
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "User",
      entityId: user.id,
      userId: user.id,
      actorRole: user.role,
      ipAddress,
    });

    return NextResponse.json(SENT_RESPONSE);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    console.error("Forgot-password error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
