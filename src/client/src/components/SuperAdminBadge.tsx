import { Crown } from "lucide-react";
import { cn } from "../lib/utils";

export function SuperAdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-red-500/40",
        "bg-red-500/20 px-1.5 py-0 leading-none text-[10px] font-semibold tracking-wide",
        "text-red-200 shadow-[0_0_10px_rgba(239,68,68,0.25)]",
        className
      )}
      title="Super Admin · KING (unlimited)"
    >
      <Crown className="h-2.5 w-2.5 text-red-400" strokeWidth={2.4} />
      KING
    </span>
  );
}
