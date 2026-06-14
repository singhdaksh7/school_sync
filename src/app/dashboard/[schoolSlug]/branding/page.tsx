import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import BrandingClient from "./BrandingClient";

export default async function BrandingPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const branding = await prisma.school.findUnique({
    where: { id: school.id },
    select: {
      id: true,
      name: true,
      slug: true,
      customDomain: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      appName: true,
      poweredBySchoolSync: true,
    },
  });
  if (!branding) return null;

  return <BrandingClient initialBranding={branding} />;
}
