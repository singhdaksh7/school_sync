"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { getAdminNavGroups } from "@/lib/nav/admin-nav";
import type { FeatureFlagKeyValue } from "@/lib/feature-flag-constants";

interface AdminModuleGridProps {
  schoolSlug: string;
  userRole: string;
  featureFlags?: Record<FeatureFlagKeyValue, boolean>;
}

/**
 * Landing-page tile grid for the School Admin dashboard. Reuses
 * getAdminNavGroups (the same source of truth as the sidebar) so a tile
 * never appears here unless the equivalent sidebar item would also show for
 * this user/role/feature-flag combination.
 */
export default function AdminModuleGrid({ schoolSlug, userRole, featureFlags }: AdminModuleGridProps) {
  const { t } = useTranslation();
  const base = `/dashboard/${schoolSlug}`;

  const flagEnabled = (key: FeatureFlagKeyValue) => featureFlags?.[key] ?? true;
  const groups = getAdminNavGroups(t, base, userRole, flagEnabled);

  // "Overview" just points at this very page — it doesn't make sense as a
  // tile on the page it links to.
  const tileGroups = groups.filter((g) => g.id !== "overview");

  return (
    <div className="space-y-6">
      {tileGroups.map((group) => {
        const visibleItems = group.items.filter((item) => item.show);
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.id} className="space-y-3">
            {group.title && (
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/70">{group.title}</h3>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visibleItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-primary"
                      style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.14), hsl(var(--primary) / 0.05))" }}
                    >
                      <item.icon className="h-5 w-5" />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <span className="text-sm font-semibold leading-tight text-foreground">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
