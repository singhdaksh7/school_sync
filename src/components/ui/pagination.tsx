"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  if (pageCount <= 1) return null;

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1
  );

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4" /> Prev
      </Button>
      <div className="flex items-center gap-1">
        {pages.map((p, idx) => (
          <span key={p} className="flex items-center gap-1">
            {idx > 0 && pages[idx - 1] !== p - 1 && <span className="px-1 text-xs text-muted-foreground">...</span>}
            <button
              onClick={() => onPageChange(p)}
              className={cn(
                "h-8 w-8 rounded-md text-sm font-medium transition-colors",
                p === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {p}
            </button>
          </span>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        className="gap-1"
      >
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export { Pagination };
