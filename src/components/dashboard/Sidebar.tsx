"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap, LayoutDashboard, Users, BookOpen,
  ClipboardCheck, Settings, UserPlus, ChevronRight,
  CalendarDays, FileText, BarChart2, Award,
  Megaphone, CalendarOff, IndianRupee,
  ClipboardList, PieChart, Activity, BarChart, X, Wand2, BookOpenCheck, Replace, Palette, ShieldCheck, LayoutTemplate,
  CreditCard, BookCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeatureFlagKeyValue } from "@/lib/feature-flag-constants";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface SidebarProps {
  school: { slug: string; name: string; logoUrl?: string | null };
  userRole: string;
  featureFlags?: Record<FeatureFlagKeyValue, boolean>;
  onClose?: () => void;
}

const ROLE_LABEL_KEYS: Record<string, string> = {
  SCHOOL_OWNER: "common.roleOwner",
  SCHOOL_ADMIN: "common.roleAdmin",
  VICE_PRINCIPAL: "common.roleVicePrincipal",
  TEACHER: "common.roleTeacher",
};

const ROLE_COLORS: Record<string, string> = {
  SCHOOL_OWNER: "bg-blue-100 text-blue-700",
  SCHOOL_ADMIN: "bg-purple-100 text-purple-700",
  VICE_PRINCIPAL: "bg-green-100 text-green-700",
  TEACHER: "bg-orange-100 text-orange-700",
};

export default function Sidebar({ school, userRole, featureFlags, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const base = `/dashboard/${school.slug}`;
  const isOwnerOrAdmin = userRole === "SCHOOL_OWNER" || userRole === "SCHOOL_ADMIN";

  // Absence of featureFlags (e.g. not yet wired in a caller) means everything
  // stays visible — flags are opt-out, not opt-in.
  const flagEnabled = (key: FeatureFlagKeyValue) => featureFlags?.[key] ?? true;

  const navItems = [
    { href: base, label: t("nav.overview"), icon: LayoutDashboard, show: true },
    { href: `${base}/classes`, label: t("nav.classesAndSections"), icon: BookOpen, show: true },
    { href: `${base}/teachers`, label: t("nav.teachers"), icon: Users, show: true },
    { href: `${base}/teacher-roles`, label: t("nav.teacherRoles"), icon: ShieldCheck, show: isOwnerOrAdmin && flagEnabled("TEACHER_PERMISSIONS") },
    { href: `${base}/students`, label: t("nav.students"), icon: GraduationCap, show: true },
    { href: `${base}/attendance`, label: t("nav.attendance"), icon: ClipboardCheck, show: flagEnabled("ATTENDANCE") },
    { href: `${base}/reports`, label: t("nav.attendanceReports"), icon: BarChart2, show: flagEnabled("ATTENDANCE") },
    { href: `${base}/timetable`, label: t("nav.timetable"), icon: CalendarDays, show: true },
    { href: `${base}/custom-timetable`, label: t("nav.customTimetable"), icon: Wand2, show: isOwnerOrAdmin },
    { href: `${base}/homework`, label: t("nav.homework"), icon: BookOpenCheck, show: flagEnabled("HOMEWORK") },
    { href: `${base}/exam-schemes`, label: t("nav.examSchemes"), icon: FileText, show: true },
    { href: `${base}/exam-milestones`, label: t("nav.examMilestones"), icon: BookCheck, show: flagEnabled("NOTEBOOK_CHECKING") },
    { href: `${base}/results`, label: t("nav.results"), icon: Award, show: true },
    { href: `${base}/report-cards`, label: t("nav.reportCards"), icon: ClipboardList, show: flagEnabled("REPORT_CARDS") },
    { href: `${base}/report-card-builder`, label: t("nav.reportCardBuilder"), icon: LayoutTemplate, show: isOwnerOrAdmin && flagEnabled("REPORT_CARD_BUILDER") },
    { href: `${base}/fees`, label: t("nav.feeManagement"), icon: IndianRupee, show: flagEnabled("FEES") },
    { href: `${base}/leaves`, label: t("nav.leaveManagement"), icon: ClipboardList, show: true },
    { href: `${base}/substitutions`, label: t("nav.substitutions"), icon: Replace, show: true },
    { href: `${base}/analytics`, label: t("nav.analytics"), icon: PieChart, show: flagEnabled("ANALYTICS") },
    { href: `${base}/teachers/workload`, label: t("nav.teacherWorkload"), icon: BarChart, show: true },
    { href: `${base}/announcements`, label: t("nav.announcements"), icon: Megaphone, show: true },
    { href: `${base}/holidays`, label: t("nav.holidayCalendar"), icon: CalendarOff, show: true },
    { href: `${base}/audit-logs`, label: t("nav.auditLogs"), icon: Activity, show: isOwnerOrAdmin },
    { href: `${base}/invite`, label: t("nav.inviteStaff"), icon: UserPlus, show: isOwnerOrAdmin },
    { href: `${base}/branding`, label: t("nav.branding"), icon: Palette, show: isOwnerOrAdmin && flagEnabled("WHITE_LABEL") },
    { href: `${base}/billing`, label: t("nav.billing"), icon: CreditCard, show: isOwnerOrAdmin },
    { href: `${base}/settings`, label: t("nav.settings"), icon: Settings, show: isOwnerOrAdmin },
  ].filter((item) => item.show);

  return (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground md:m-2.5 md:h-[calc(100%-1.25rem)] md:rounded-2xl md:border md:border-sidebar-border md:shadow-sm">
      {/* Brand block */}
      <div className="p-3">
        <div
          className="flex items-center gap-3 rounded-xl p-3"
          style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.04))" }}
        >
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-md"
            style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7))" }}
          >
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{school.name}</p>
            <p className="text-[11px] text-muted-foreground">SchoolSync</p>
          </div>
          {/* Close button — only visible on mobile */}
          {onClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground md:hidden"
              aria-label={t("common.closeMenu")}
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("common.menu")}</div>

      {/* Nav */}
      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary font-semibold text-primary-foreground shadow-md shadow-primary/25"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-x-1.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true" />
              )}
              <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
              <span className="truncate">{item.label}</span>
              {active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom role badge */}
      <div className="p-3">
        <div className="flex items-center justify-between rounded-xl border border-sidebar-border bg-muted/40 px-3 py-2.5">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", ROLE_COLORS[userRole] || "bg-muted text-muted-foreground")}>
            {ROLE_LABEL_KEYS[userRole] ? t(ROLE_LABEL_KEYS[userRole]) : userRole}
          </span>
          <span className="text-[10px] text-muted-foreground">SchoolSync</span>
        </div>
      </div>
    </aside>
  );
}
