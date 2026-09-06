import { Star } from "lucide-react";
import { cn } from "../lib/utils";

export function ProBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-blue-400/35",
        "bg-blue-500/15 px-1.5 py-0 leading-none text-[10px] font-semibold tracking-wide",
        "text-blue-200",
        className
      )}
      title="Pro · role-restricted model access"
    >
      <Star className="h-2.5 w-2.5" strokeWidth={2.6} fill="currentColor" />
      PRO
    </span>
  );
}
