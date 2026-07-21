import { notFound } from "next/navigation";
import { getSchoolBySlug } from "@/lib/school";
import { isFeatureEnabled } from "@/lib/feature-flags";
import LibraryDashboardClient from "./LibraryDashboardClient";

export default async function LibraryDashboardPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) notFound();

  const enabled = await isFeatureEnabled(school.id, "LIBRARY");
  if (!enabled) notFound();

  return <LibraryDashboardClient schoolId={school.id} />;
}
