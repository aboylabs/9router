import { Wrench } from "lucide-react";
import { cn } from "../lib/utils";

/** Compact HELPER / Builder chip (admin panel). */
export function HelperBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-emerald-400/45",
        "bg-gradient-to-r from-emerald-500/20 via-teal-400/15 to-green-500/20",
        "px-1.5 py-0 leading-none text-[10px] font-extrabold tracking-wide",
        "shadow-[0_0_6px_rgba(52,211,153,0.3)]",
        className
      )}
      title="Helper · Builder (unlimited · no expiry)"
    >
      <Wrench className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-300" strokeWidth={2.4} />
      <span className="bg-gradient-to-r from-emerald-700 via-teal-600 to-green-600 dark:from-emerald-200 dark:via-teal-200 dark:to-green-300 bg-clip-text text-transparent">
        HELPER
      </span>
    </span>
  );
}
