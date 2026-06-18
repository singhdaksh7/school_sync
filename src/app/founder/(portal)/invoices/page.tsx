import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import InvoicesClient from "./InvoicesClient";

export default async function FounderInvoicesPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return <InvoicesClient />;
}
