import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { serializeReservationPublic } from "@/lib/library/serializers";
import { createReservation } from "@/lib/library/service";
import { libraryServiceError } from "@/lib/library/http";

const createSchema = z.object({ bookId: z.string().trim().min(1) });

export async function GET(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.schoolId, "LIBRARY");
  if (denied) return denied;

  const rows = await prisma.libraryReservation.findMany({
    where: { schoolId: auth.schoolId, studentId: auth.studentId },
    orderBy: [{ requestedAt: "desc" }],
    include: { book: true },
  });

  const serialized = await Promise.all(
    rows.map(async (r) => {
      let queuePosition: number | undefined;
      if (r.status === "PENDING") {
        const ahead = await prisma.libraryReservation.count({
          where: { schoolId: auth.schoolId, bookId: r.bookId, status: "PENDING", requestedAt: { lt: r.requestedAt } },
        });
        queuePosition = ahead + 1;
      }
      return serializeReservationPublic(r, { queuePosition });
    })
  );

  return NextResponse.json(serialized);
}

export async function POST(req: Request) {
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.schoolId, "LIBRARY");
  if (denied) return denied;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await createReservation({
    schoolId: auth.schoolId,
    bookId: body.bookId,
    borrower: { type: "STUDENT", id: auth.studentId },
    actor: { userId: auth.studentId, role: "STUDENT" },
    skipAudit: true,
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data, { status: 201 });
}
