import type { Metadata } from "next";
import TeacherLayout from "@/components/teacher/TeacherLayout";
import { auth } from "@/lib/auth";
import { tenantAppNameForSchoolId } from "@/lib/school-resolver";

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  const schoolId = (session?.user as { schoolId?: string | null } | undefined)?.schoolId;
  const appName = schoolId ? await tenantAppNameForSchoolId(schoolId) : null;
  return { title: `Teacher Portal | ${appName ?? "SchoolSync"}` };
}

export default function TeacherPortalLayout({ children }: { children: React.ReactNode }) {
  return <TeacherLayout>{children}</TeacherLayout>;
}
