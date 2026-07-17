"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, ClipboardList, LogOut, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useParentAuth } from "@/lib/parent-web-auth";

const PARENT_NAV_ITEMS = [{ href: "/parent/leave", labelKey: "nav.leaveRequests", icon: ClipboardList }];

export default function ParentSidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { user, logout } = useParentAuth();

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
            <p className="truncate text-sm font-bold leading-tight">{user?.name || "SchoolSync"}</p>
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              <Sparkles className="h-2.5 w-2.5" /> {t("nav.parentPortal")}
            </span>
          </div>
        </div>
      </div>

      <nav aria-label="Parent navigation" className="flex-1 space-y-1 px-3 py-1">
        {PARENT_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                active ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-[18px] w-[18px]" />
          {t("common.logout")}
        </button>
      </div>
    </aside>
  );
}
