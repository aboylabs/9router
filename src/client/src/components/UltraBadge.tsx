import { Zap } from "lucide-react";
import { cn } from "../lib/utils";

/** Compact ULTRA chip for 500M-quota keys (admin panel). */
export function UltraBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-cyan-400/45",
        "bg-gradient-to-r from-sky-500/20 via-cyan-400/15 to-blue-500/20",
        "px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider",
        "shadow-[0_0_14px_rgba(34,211,238,0.4)]",
        className
      )}
      title="Ultra · 500M quota"
    >
      <Zap className="h-3 w-3 text-cyan-600 dark:text-cyan-300" strokeWidth={2.6} fill="currentColor" />
      <span className="bg-gradient-to-r from-sky-700 via-cyan-600 to-blue-600 dark:from-sky-200 dark:via-cyan-200 dark:to-blue-300 bg-clip-text text-transparent">
        ULTRA
      </span>
    </span>
  );
}
