"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeatureFlagKeyValue } from "@/lib/feature-flag-constants";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { getAdminNavGroups } from "@/lib/nav/admin-nav";

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

  // Absence of featureFlags (e.g. not yet wired in a caller) means everything
  // stays visible — flags are opt-out, not opt-in.
  const flagEnabled = (key: FeatureFlagKeyValue) => featureFlags?.[key] ?? true;

  const groups = getAdminNavGroups(t, base, userRole, flagEnabled);

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

      {/* Nav */}
      <nav className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-3 py-1">
        {groups.map((group) => {
          const visibleItems = group.items.filter((item) => item.show);
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.id} className="space-y-1">
              {group.title && (
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  {group.title}
                </div>
              )}
              {visibleItems.map((item) => {
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
            </div>
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
