import { Wrench } from "lucide-react";
import { cn } from "../lib/utils";

export function HelperBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-emerald-400/35",
        "bg-emerald-500/15 px-1.5 py-0 leading-none text-[10px] font-semibold tracking-wide",
        "text-emerald-200",
        className
      )}
      title="Helper · Builder (unlimited · no expiry)"
    >
      <Wrench className="h-2.5 w-2.5" strokeWidth={2.4} />
      HELPER
    </span>
  );
}
