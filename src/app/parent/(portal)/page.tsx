"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ParentPortalIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/parent/leave");
  }, [router]);
  return null;
}
