import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existingSchool = await prisma.school.findUnique({
    where: { ownerId: session.user.id },
  });
  if (existingSchool) {
    return NextResponse.json({ error: "School already exists" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    let slug = slugify(data.name);
    const slugExists = await prisma.school.findUnique({ where: { slug } });
    if (slugExists) slug = `${slug}-${Date.now()}`;

    const school = await prisma.school.create({
      data: {
        name: data.name,
        slug,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        website: data.website || null,
        ownerId: session.user.id,
      },
    });

    return NextResponse.json(school, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
