import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";
import StudentLayout from "@/components/student/StudentLayout";
import { tenantAppNameForSchoolId } from "@/lib/school-resolver";

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  const schoolId = (session?.user as { schoolId?: string | null } | undefined)?.schoolId;
  const appName = schoolId ? await tenantAppNameForSchoolId(schoolId) : null;
  return { title: `Student Portal | ${appName ?? "SchoolSync"}` };
}

export default async function StudentPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "STUDENT") redirect("/student/login");

  return <StudentLayout>{children}</StudentLayout>;
}
