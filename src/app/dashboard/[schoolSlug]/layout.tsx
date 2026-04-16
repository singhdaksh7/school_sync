import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSchoolBySlug } from "@/lib/school";
import { redirect, notFound } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const role = (session.user as any).role as string;

  const school = await getSchoolBySlug(schoolSlug);

  if (!school) notFound();

  const userId = session.user.id;
  const hasAccess =
    school.ownerId === userId ||
    school.admins?.some((a: any) => a.id === userId);

  if (!hasAccess) {
    const userSchool = await prisma.school.findFirst({
      where: { OR: [{ ownerId: userId }, { admins: { some: { id: userId } } }] },
    });
    if (userSchool) redirect(`/dashboard/${userSchool.slug}`);
    redirect("/onboarding");
  }

  return (
    <DashboardShell school={school} user={session.user} userRole={role}>
      {children}
    </DashboardShell>
  );
}
