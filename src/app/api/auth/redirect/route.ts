import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function GET() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (role === "TEACHER") redirect("/teacher/attendance");

  const schoolSlug = (session.user as any).schoolSlug;
  if (schoolSlug) redirect(`/dashboard/${schoolSlug}`);
  redirect("/onboarding");
}
