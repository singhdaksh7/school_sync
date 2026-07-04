import { prisma } from "@/lib/prisma";
import { requireFounderSession } from "@/lib/founder";
import { redirect } from "next/navigation";
import InvitesClient from "./InvitesClient";

export default async function FounderInvitesPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  const invites = await prisma.schoolInvite.findMany({
    where: { invitedBy: { role: "FOUNDER" } },
    include: {
      school: { select: { id: true, name: true, slug: true } },
      plan: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return <InvitesClient initialInvites={invites} />;
}
