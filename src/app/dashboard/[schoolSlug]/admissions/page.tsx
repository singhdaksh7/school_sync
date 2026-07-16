import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSchoolBySlug } from "@/lib/school";
import { sessionRole } from "@/lib/tenant";
import { getAdmissionsDashboardSummary } from "@/lib/admissions/dashboard";
import AdmissionsDashboardClient from "./AdmissionsDashboardClient";

export default async function AdmissionsDashboardPage({ params }: { params: Promise<{ schoolSlug: string }> }) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  const role = sessionRole(session.user) ?? "";
  if (!["SCHOOL_OWNER", "SCHOOL_ADMIN", "VICE_PRINCIPAL"].includes(role)) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admissions is not available for your role.
      </div>
    );
  }

  const summary = await getAdmissionsDashboardSummary(school.id);
  return <AdmissionsDashboardClient schoolSlug={schoolSlug} summary={summary} canManage={role === "SCHOOL_OWNER" || role === "SCHOOL_ADMIN"} />;
}
