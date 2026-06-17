import { redirect } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import SchoolsClient from "./SchoolsClient";

export default async function FounderSchoolsPage() {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  return <SchoolsClient />;
}
