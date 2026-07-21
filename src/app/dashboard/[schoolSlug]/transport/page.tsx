import { notFound } from "next/navigation";
import { getSchoolBySlug } from "@/lib/school";
import { isFeatureEnabled } from "@/lib/feature-flags";
import TransportDashboardClient from "./TransportDashboardClient";

export default async function TransportDashboardPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) notFound();

  const enabled = await isFeatureEnabled(school.id, "TRANSPORT");
  if (!enabled) notFound();

  return <TransportDashboardClient schoolId={school.id} />;
}
