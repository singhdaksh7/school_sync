import { getSchoolBySlug } from "@/lib/school";
import NotificationsPageContent from "@/components/notifications/NotificationsPageContent";

export default async function AdminNotificationsPage({ params }: { params: Promise<{ schoolSlug: string }> }) {
  const { schoolSlug } = await params;
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) return null;

  return (
    <NotificationsPageContent
      role="admin"
      basePath={`/api/schools/${school.id}/notifications`}
      rolePrefix={`/dashboard/${school.slug}`}
    />
  );
}
