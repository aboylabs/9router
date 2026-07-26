import { Code2 } from "lucide-react";
import { cn } from "../lib/utils";

/** Compact developer chip for Super Admin rows (admin panel). */
export function SuperAdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-fuchsia-400/40",
        "bg-gradient-to-r from-purple-500/20 via-fuchsia-500/15 to-pink-500/20",
        "px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider",
        "shadow-[0_0_12px_rgba(192,132,252,0.28)]",
        className
      )}
      title="Super Admin · Developer (unlimited)"
    >
      <Code2 className="h-3 w-3 text-purple-600 dark:text-purple-300" strokeWidth={2.4} />
      <span className="bg-gradient-to-r from-purple-700 via-fuchsia-600 to-pink-600 dark:from-purple-300 dark:via-fuchsia-300 dark:to-pink-300 bg-clip-text text-transparent">
        DEV
      </span>
    </span>
  );
}
