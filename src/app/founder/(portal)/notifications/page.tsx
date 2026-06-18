import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import NotificationsClient from "./NotificationsClient";

export default async function FounderNotificationsPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return <NotificationsClient />;
}
