import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { getRevenueSummary } from "@/lib/revenue";

export async function GET() {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const summary = await getRevenueSummary();
  return NextResponse.json(summary);
}
