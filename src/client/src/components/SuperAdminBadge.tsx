import { Crown } from "lucide-react";
import { cn } from "../lib/utils";

export function SuperAdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-fuchsia-400/35",
        "bg-fuchsia-500/15 px-1.5 py-0 leading-none text-[10px] font-semibold tracking-wide",
        "text-fuchsia-200",
        className
      )}
      title="Super Admin · Developer (unlimited)"
    >
      <Crown className="h-2.5 w-2.5" strokeWidth={2.4} />
      DEV
    </span>
  );
}
