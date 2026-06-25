import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { createNotification } from "@/lib/founder-notifications";
import { requireFounderSession } from "@/lib/founder";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().optional(),
});

// School creation is Founder-only -- there is no public/self-serve signup.
// A school created here has no owner yet (ownerId stays null); the first
// person to accept a Founder-issued admin invite for it becomes the owner
// (see the accept-invite route).
export async function POST(req: Request) {
  const session = await requireFounderSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      },
    });

    await createNotification({
      type: "SCHOOL_REGISTERED",
      title: "New school registered",
      message: `${school.name} was created by the Founder.`,
      schoolId: school.id,
    });

    await logAudit({
      action: "SCHOOL_CREATED",
      entityType: "School",
      entityId: school.id,
      metadata: { name: school.name },
      userId: session.user.id,
      schoolId: school.id,
    });

    return NextResponse.json(school, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
