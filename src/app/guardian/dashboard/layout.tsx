import GuardianShell from "@/components/guardian/GuardianShell";

export default function GuardianDashboardLayout({ children }: { children: React.ReactNode }) {
  return <GuardianShell>{children}</GuardianShell>;
}
