"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck, LayoutDashboard, Building2, PieChart,
  IndianRupee, CreditCard, Flag, Settings, ChevronRight, X,
  Receipt, FileText, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FounderSidebarProps {
  onClose?: () => void;
}

const navItems = [
  { href: "/founder/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/founder/schools", label: "Schools", icon: Building2 },
  { href: "/founder/analytics", label: "Analytics", icon: PieChart },
  { href: "/founder/revenue", label: "Revenue", icon: IndianRupee },
  { href: "/founder/billing", label: "Billing", icon: CreditCard },
  { href: "/founder/payment-proofs", label: "Payment Proofs", icon: Receipt },
  { href: "/founder/invoices", label: "Invoices", icon: FileText },
  { href: "/founder/feature-flags", label: "Feature Flags", icon: Flag },
  { href: "/founder/notifications", label: "Notifications", icon: Bell },
  { href: "/founder/settings", label: "Settings", icon: Settings },
];

export default function FounderSidebar({ onClose }: FounderSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground md:m-2.5 md:h-[calc(100%-1.25rem)] md:rounded-2xl md:border md:border-sidebar-border md:shadow-sm">
      <div className="p-3">
        <div
          className="flex items-center gap-3 rounded-xl p-3"
          style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.16), rgba(99,102,241,0.04))" }}
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">Founder Portal</p>
            <p className="text-[11px] text-muted-foreground">SchoolSync Platform</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground md:hidden"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Menu</div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-indigo-600 font-semibold text-white shadow-md shadow-indigo-900/25"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-x-1.5 -translate-y-1/2 rounded-full bg-indigo-600" aria-hidden="true" />
              )}
              <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
              <span className="truncate">{item.label}</span>
              {active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        <div className="flex items-center justify-between rounded-xl border border-sidebar-border bg-muted/40 px-3 py-2.5">
          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Founder
          </span>
          <span className="text-[10px] text-muted-foreground">SchoolSync</span>
        </div>
      </div>
    </aside>
  );
}
