"use client";

import Link from "next/link";
import {
  GraduationCap, LayoutDashboard, IndianRupee, ClipboardCheck, BookOpenCheck,
  Award, ClipboardList, CalendarDays, Megaphone, X, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";

/**
 * Guardian has no separate route per module (unlike the other five portals)
 * — everything lives on one dashboard page as real-data sections, since this
 * is this role's first-ever web presence and only the dashboard was in
 * scope. These items are in-page anchors to those sections, mirroring the
 * structure (not the routing) of StudentSidebar.
 */
export interface GuardianNavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
}

export const GUARDIAN_NAV_ITEMS: GuardianNavItem[] = [
  { href: "#top", labelKey: "nav.overview", icon: LayoutDashboard },
  { href: "#fees", labelKey: "guardian.fees", icon: IndianRupee },
  { href: "#attendance", labelKey: "nav.attendance", icon: ClipboardCheck },
  { href: "#homework", labelKey: "nav.homework", icon: BookOpenCheck },
  { href: "#marks", labelKey: "nav.marks", icon: Award },
  { href: "#report-cards", labelKey: "nav.reportCards", icon: ClipboardList },
  { href: "#timetable", labelKey: "nav.timetable", icon: CalendarDays },
  { href: "#announcements", labelKey: "nav.announcements", icon: Megaphone },
];

interface GuardianSidebarProps {
  schoolName?: string;
  onClose?: () => void;
}

export default function GuardianSidebar({ schoolName, onClose }: GuardianSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground md:m-2.5 md:h-[calc(100%-1.25rem)] md:rounded-2xl md:border md:border-sidebar-border md:shadow-sm">
      <div className="p-3">
        <div
          className="flex items-center gap-3 rounded-xl p-3"
          style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(99,102,241,0.04))" }}
        >
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-md"
            style={{ background: "linear-gradient(135deg, #0ea5e9, #6366f1)" }}
          >
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{schoolName || "SchoolSync"}</p>
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              <Sparkles className="h-2.5 w-2.5" /> {t("guardian.portalTitle")}
            </span>
          </div>
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

      <div className="px-5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("common.menu")}
      </div>

      <nav aria-label="Guardian navigation" className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {GUARDIAN_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={`/guardian/dashboard${item.href === "#top" ? "" : item.href}`}
            onClick={onClose}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
            <span className="truncate">{t(item.labelKey)}</span>
          </Link>
        ))}
      </nav>

      <div className="p-3">
        <div className="flex items-center justify-center gap-1.5 rounded-xl border border-sidebar-border bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          <span>
            {t("common.poweredBy")} <span className="font-bold text-foreground">SchoolSync</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
