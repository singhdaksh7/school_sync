import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import FounderShell from "@/components/founder/FounderShell";

export default async function FounderPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return (
    <FounderShell user={{ name: session.user?.name, email: session.user?.email }}>
      {children}
    </FounderShell>
  );
}
