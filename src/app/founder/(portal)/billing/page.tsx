import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import BillingPlansClient from "./BillingPlansClient";

export default async function FounderBillingPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return <BillingPlansClient />;
}
