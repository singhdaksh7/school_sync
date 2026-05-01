import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const status: Record<string, unknown> = {
    database_url_set: !!process.env.DATABASE_URL,
    nextauth_secret_set: !!process.env.NEXTAUTH_SECRET,
    nextauth_url: process.env.NEXTAUTH_URL || "not_set",
  };

  try {
    const count = await prisma.user.count();
    status.db = "connected";
    status.user_count = count;
  } catch (err) {
    status.db = "error";
    status.db_error = String(err);
  }

  return NextResponse.json(status);
}
