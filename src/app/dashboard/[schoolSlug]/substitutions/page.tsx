import { getSchoolBySlug } from "@/lib/school";
import SubstitutionsClient from "./SubstitutionsClient";

export default async function SubstitutionsPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  return <SubstitutionsClient schoolId={school.id} />;
}
