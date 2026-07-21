import {
  GraduationCap, LayoutDashboard, Users, BookOpen,
  ClipboardCheck, Settings, UserPlus,
  CalendarDays, FileText, BarChart2, Award,
  Megaphone, CalendarOff, IndianRupee,
  ClipboardList, PieChart, Activity, BarChart, Wand2, BookOpenCheck, Replace, Palette, ShieldCheck, LayoutTemplate,
  CreditCard, BookCheck, ListTree, UserMinus, Library, Bus,
} from "lucide-react";
import type { FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  show: boolean;
}

export interface AdminNavGroup {
  id: string;
  title: string | null;
  items: AdminNavItem[];
}

/**
 * Shared source of truth for School Admin navigation — consumed by both the
 * sidebar (src/components/dashboard/Sidebar.tsx) and the dashboard module
 * grid (src/components/dashboard/AdminModuleGrid.tsx) so the two never drift.
 */
export function getAdminNavGroups(
  t: (key: string) => string,
  base: string,
  userRole: string,
  flagEnabled: (key: FeatureFlagKeyValue) => boolean
): AdminNavGroup[] {
  const isOwnerOrAdmin = userRole === "SCHOOL_OWNER" || userRole === "SCHOOL_ADMIN";

  return [
    {
      id: "overview",
      title: null,
      items: [
        { href: base, label: t("nav.overview"), icon: LayoutDashboard, show: true },
      ],
    },
    {
      id: "people",
      title: t("nav.groupPeople"),
      items: [
        { href: `${base}/students`, label: t("nav.students"), icon: GraduationCap, show: true },
        { href: `${base}/admissions`, label: t("nav.admissions"), icon: UserPlus, show: flagEnabled("ADMISSIONS") },
        { href: `${base}/teachers`, label: t("nav.teachers"), icon: Users, show: true },
        { href: `${base}/teachers/deleted`, label: t("nav.deletedTeachers"), icon: UserMinus, show: isOwnerOrAdmin },
        { href: `${base}/teacher-roles`, label: t("nav.teacherRoles"), icon: ShieldCheck, show: isOwnerOrAdmin && flagEnabled("TEACHER_PERMISSIONS") },
      ],
    },
    {
      id: "academics",
      title: t("nav.groupAcademics"),
      items: [
        { href: `${base}/classes`, label: t("nav.classesAndSections"), icon: BookOpen, show: true },
        { href: `${base}/subjects`, label: t("nav.subjectMaster"), icon: ListTree, show: isOwnerOrAdmin },
        { href: `${base}/timetable`, label: t("nav.timetable"), icon: CalendarDays, show: true },
        { href: `${base}/custom-timetable`, label: t("nav.customTimetable"), icon: Wand2, show: isOwnerOrAdmin },
        { href: `${base}/homework`, label: t("nav.homework"), icon: BookOpenCheck, show: flagEnabled("HOMEWORK") },
        { href: `${base}/attendance`, label: t("nav.attendance"), icon: ClipboardCheck, show: flagEnabled("ATTENDANCE") },
        { href: `${base}/reports`, label: t("nav.attendanceReports"), icon: BarChart2, show: flagEnabled("ATTENDANCE") },
        { href: `${base}/exam-milestones`, label: t("nav.examMilestones"), icon: BookCheck, show: flagEnabled("NOTEBOOK_CHECKING") },
        { href: `${base}/library`, label: t("nav.library"), icon: Library, show: flagEnabled("LIBRARY") },
      ],
    },
    {
      id: "exams",
      title: t("nav.groupExams"),
      items: [
        { href: `${base}/exam-schemes`, label: t("nav.examSchemes"), icon: FileText, show: true },
        { href: `${base}/results`, label: t("nav.results"), icon: Award, show: true },
        { href: `${base}/report-cards`, label: t("nav.reportCards"), icon: ClipboardList, show: flagEnabled("REPORT_CARDS") },
        { href: `${base}/report-card-builder`, label: t("nav.reportCardBuilder"), icon: LayoutTemplate, show: isOwnerOrAdmin && flagEnabled("REPORT_CARD_BUILDER") },
      ],
    },
    {
      id: "finance",
      title: t("nav.groupFinance"),
      items: [
        { href: `${base}/fees`, label: t("nav.feeManagement"), icon: IndianRupee, show: flagEnabled("FEES") },
        { href: `${base}/transport`, label: t("nav.transport"), icon: Bus, show: flagEnabled("TRANSPORT") },
        { href: `${base}/leaves`, label: t("nav.leaveManagement"), icon: ClipboardList, show: true },
        { href: `${base}/substitutions`, label: t("nav.substitutions"), icon: Replace, show: true },
        { href: `${base}/announcements`, label: t("nav.announcements"), icon: Megaphone, show: true },
        { href: `${base}/holidays`, label: t("nav.holidayCalendar"), icon: CalendarOff, show: true },
      ],
    },
    {
      id: "system",
      title: t("nav.groupSystem"),
      items: [
        { href: `${base}/analytics`, label: t("nav.analytics"), icon: PieChart, show: flagEnabled("ANALYTICS") },
        { href: `${base}/teachers/workload`, label: t("nav.teacherWorkload"), icon: BarChart, show: true },
        { href: `${base}/audit-logs`, label: t("nav.auditLogs"), icon: Activity, show: isOwnerOrAdmin },
        { href: `${base}/invite`, label: t("nav.inviteStaff"), icon: UserPlus, show: isOwnerOrAdmin },
        { href: `${base}/branding`, label: t("nav.branding"), icon: Palette, show: isOwnerOrAdmin && flagEnabled("WHITE_LABEL") },
        { href: `${base}/billing`, label: t("nav.billing"), icon: CreditCard, show: isOwnerOrAdmin },
        { href: `${base}/settings`, label: t("nav.settings"), icon: Settings, show: isOwnerOrAdmin },
      ],
    },
  ];
}
