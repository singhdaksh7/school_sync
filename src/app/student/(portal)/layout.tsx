import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";
import StudentLayout from "@/components/student/StudentLayout";

export default async function StudentPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id || sessionRole(session.user) !== "STUDENT") redirect("/student/login");

  return <StudentLayout>{children}</StudentLayout>;
}
