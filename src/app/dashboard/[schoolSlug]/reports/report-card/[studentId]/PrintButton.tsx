"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()} className="gap-2 ml-auto">
      <Printer className="w-4 h-4" /> Print / Save as PDF
    </Button>
  );
}
