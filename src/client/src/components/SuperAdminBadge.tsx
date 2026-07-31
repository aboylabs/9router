import { Crown } from "lucide-react";
import { cn } from "../lib/utils";

/** Premium developer chip for Super Admin rows (admin panel).
 *  Crown icon + pulsing glow + shimmer sweep + sparkle particles. */
export function SuperAdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "sa-badge-amin relative overflow-hidden inline-flex items-center gap-1 shrink-0",
        "rounded-md border border-fuchsia-400/50",
        "bg-gradient-to-r from-purple-500/25 via-fuchsia-500/20 to-pink-500/25",
        "px-1.5 py-0 leading-none text-[10px] font-extrabold tracking-wide",
        "shadow-[0_0_6px_rgba(192,132,252,0.3)]",
        className
      )}
      title="Super Admin · Developer (unlimited)"
    >
      {/* Sparkle particles */}
      <span className="sa-sparkle sa-sparkle-1" style={{ top: "-2px", right: "8px" }} />
      <span className="sa-sparkle sa-sparkle-2" style={{ top: "0px", left: "6px" }} />

      <Crown
        className="sa-icon-anim relative z-10 h-2.5 w-2.5 text-purple-600 dark:text-purple-300"
        strokeWidth={2.4}
        fill="currentColor"
        fillOpacity={0.15}
      />
      <span className="relative z-10 bg-gradient-to-r from-purple-700 via-fuchsia-600 to-pink-600 dark:from-purple-300 dark:via-fuchsia-300 dark:to-pink-300 bg-clip-text text-transparent">
        DEV
      </span>
    </span>
  );
}
