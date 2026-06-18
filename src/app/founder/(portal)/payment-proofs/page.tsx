import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import PaymentProofsClient from "./PaymentProofsClient";

export default async function FounderPaymentProofsPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return <PaymentProofsClient />;
}
