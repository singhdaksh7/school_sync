import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";

export default async function FounderRootPage() {
  const session = await requireFounderSession();
  redirect(session ? "/founder/dashboard" : "/founder/login");
}
