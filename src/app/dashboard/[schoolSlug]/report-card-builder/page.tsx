import { getSchoolBySlug } from "@/lib/school";
import { prisma } from "@/lib/prisma";
import { serializeTemplate } from "@/lib/report-card-templates";
import ReportCardBuilderClient from "./ReportCardBuilderClient";

export default async function ReportCardBuilderPage({
  params,
}: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const [templates, classes] = await Promise.all([
    prisma.reportCardTemplate.findMany({
      where: { schoolId: school.id },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.class.findMany({
      where: { schoolId: school.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <ReportCardBuilderClient
      schoolId={school.id}
      classes={classes}
      initialTemplates={await Promise.all(templates.map(serializeTemplate))}
    />
  );
}
