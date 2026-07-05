import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createPasswordResetToken } from "@/lib/password-reset";
import { sendPasswordResetEmail, resolveSchoolNameForUser } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email() });

// Always returned (whether or not the email maps to an account) so this endpoint
// never reveals whether an account exists.
const SENT_RESPONSE = {
  message: "If an account exists for that email, password reset instructions have been sent.",
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = schema.parse(body);
    const ipAddress = getClientIp(req);

    const limit = await rateLimit(
      `forgot-password:${ipAddress ?? "unknown"}:${email.toLowerCase()}`,
      RATE_LIMIT_POLICIES.forgotPassword
    );
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
    // Do not reveal whether the account exists — respond identically either way.
    if (!user) {
      return NextResponse.json(SENT_RESPONSE);
    }

    const rawToken = await createPasswordResetToken(user.id);
    const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    const schoolName = await resolveSchoolNameForUser(user.id, user.role);
    await sendPasswordResetEmail(user.email, resetUrl, schoolName);
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
