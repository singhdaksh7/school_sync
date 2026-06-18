import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import FeatureFlagsPickerClient from "./FeatureFlagsPickerClient";

export default async function FounderFeatureFlagsPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return <FeatureFlagsPickerClient />;
}
