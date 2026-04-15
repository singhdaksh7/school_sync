import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Sidebar from "@/components/dashboard/Sidebar";
import Header from "@/components/dashboard/Header";

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

  const school = await prisma.school.findUnique({
    where: { slug: schoolSlug },
    include: { owner: true, admins: { select: { id: true } } },
  });

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
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar school={school} userRole={role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header school={school} user={session.user} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
