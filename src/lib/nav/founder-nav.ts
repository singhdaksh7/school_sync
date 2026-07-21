import {
  ShieldCheck, LayoutDashboard, Building2, PieChart,
  IndianRupee, CreditCard, Flag, Settings,
  Receipt, FileText, Bell, UserPlus,
} from "lucide-react";

export interface FounderNavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
}

/**
 * Shared source of truth for Founder navigation — consumed by both
 * FounderSidebar (src/components/founder/FounderSidebar.tsx) and the
 * dashboard module grid (src/components/founder/FounderModuleGrid.tsx) so
 * the two never drift.
 */
export const founderNavItems: FounderNavItem[] = [
  { href: "/founder/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/founder/schools", labelKey: "nav.schools", icon: Building2 },
  { href: "/founder/invites", labelKey: "nav.invites", icon: UserPlus },
  { href: "/founder/analytics", labelKey: "nav.analytics", icon: PieChart },
  { href: "/founder/revenue", labelKey: "nav.revenue", icon: IndianRupee },
  { href: "/founder/billing", labelKey: "nav.billing", icon: CreditCard },
  { href: "/founder/payment-proofs", labelKey: "nav.paymentProofs", icon: Receipt },
  { href: "/founder/invoices", labelKey: "nav.invoices", icon: FileText },
  { href: "/founder/feature-flags", labelKey: "nav.featureFlags", icon: Flag },
  { href: "/founder/notifications", labelKey: "nav.notifications", icon: Bell },
  { href: "/founder/settings", labelKey: "nav.settings", icon: Settings },
];

export const founderBadgeIcon = ShieldCheck;
