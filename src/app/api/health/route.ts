import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const testEmail = searchParams.get("email");
  const testPassword = searchParams.get("password");

  const status: Record<string, unknown> = {
    database_url_set: !!process.env.DATABASE_URL,
    nextauth_secret_set: !!process.env.NEXTAUTH_SECRET,
    nextauth_url: process.env.NEXTAUTH_URL || "not_set",
  };

  try {
    const users = await prisma.user.findMany({ select: { email: true, id: true } });
    status.db = "connected";
    status.user_count = users.length;
    // Show masked emails so user can identify their account
    status.registered_emails = users.map((u) => {
      const [local, domain] = u.email.split("@");
      const masked = local.slice(0, 2) + "***@" + domain;
      return masked;
    });

    // Test login if email+password provided
    if (testEmail && testPassword) {
      const user = await prisma.user.findUnique({ where: { email: testEmail } });
      if (!user) {
        status.login_test = "user_not_found";
      } else {
        const valid = await bcrypt.compare(testPassword, user.password);
        status.login_test = valid ? "password_match" : "password_mismatch";
      }
    }
  } catch (err) {
    status.db = "error";
    status.db_error = String(err);
  }

  return NextResponse.json(status);
}
