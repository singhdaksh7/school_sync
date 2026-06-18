import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";

export async function requireFounderSession() {
  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "FOUNDER") return null;
  return session;
}
