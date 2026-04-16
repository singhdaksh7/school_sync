import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import InviteClient from "./InviteClient";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const invites = await prisma.schoolInvite.findMany({
    where: { schoolId: school.id },
    orderBy: { createdAt: "desc" },
  });

  return <InviteClient initialInvites={JSON.parse(JSON.stringify(invites))} schoolId={school.id} />;
}
