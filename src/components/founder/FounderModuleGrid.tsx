"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { founderNavItems } from "@/lib/nav/founder-nav";

/**
 * Landing-page tile grid for the Founder dashboard. Reuses founderNavItems
 * (the same source of truth as FounderSidebar) so a tile never appears here
 * unless the equivalent sidebar item is also shown.
 */
export default function FounderModuleGrid() {
  const { t } = useTranslation();

  // "Dashboard" just points at this very page — it doesn't make sense as a
  // tile on the page it links to.
  const tiles = founderNavItems.filter((item) => item.href !== "/founder/dashboard");

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="group flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <item.icon className="h-5 w-5" />
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-600" />
          </div>
          <span className="text-sm font-semibold leading-tight text-foreground">{t(item.labelKey)}</span>
        </Link>
      ))}
    </div>
  );
}
