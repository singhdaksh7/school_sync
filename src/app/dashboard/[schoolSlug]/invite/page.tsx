import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import InviteClient from "./InviteClient";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const session = await auth();
  const role = sessionRole(session?.user);
  if (role !== "SCHOOL_OWNER" && role !== "SCHOOL_ADMIN") redirect(`/dashboard/${schoolSlug}`);

  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const invites = await prisma.schoolInvite.findMany({
    where: { schoolId: school.id },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return <InviteClient initialInvites={JSON.parse(JSON.stringify(invites))} schoolId={school.id} callerRole={role} />;
}
