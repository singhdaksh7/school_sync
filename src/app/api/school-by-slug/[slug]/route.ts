import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const school = await prisma.school.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });

  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(school);
}
