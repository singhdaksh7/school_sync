import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { getSchoolFeatureFlags } from "@/lib/feature-flags";
import { ArrowLeft } from "lucide-react";
import FeatureFlagsClient from "./FeatureFlagsClient";

export default async function FounderSchoolFeatureFlagsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const session = await requireFounderSession();
  if (!session) redirect("/founder/login");

  const { schoolId } = await params;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) notFound();

  const flags = await getSchoolFeatureFlags(schoolId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={`/founder/schools/${schoolId}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {school.name}
      </Link>

      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Feature Flags</h2>
        <p className="mt-1 text-sm text-muted-foreground">Enable or disable platform features for {school.name}.</p>
      </div>

      <FeatureFlagsClient schoolId={schoolId} initialFlags={flags} />
    </div>
  );
}
