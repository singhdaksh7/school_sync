import { Flag } from "lucide-react";
import FounderComingSoon from "@/components/founder/FounderComingSoon";

export default function FounderFeatureFlagsPage() {
  return (
    <FounderComingSoon
      icon={Flag}
      title="Feature Flags"
      description="Per-school feature flag controls will appear here in a future phase."
    />
  );
}
