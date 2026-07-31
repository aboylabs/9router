import { Zap } from "lucide-react";
import { cn } from "../lib/utils";

/** Premium ULTRA chip for 500M-quota keys — animated cyan glow + sparkles (admin panel). */
export function UltraBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ul-badge-anim inline-flex items-center gap-1 shrink-0",
        "rounded-md border border-cyan-400/50",
        "bg-gradient-to-r from-sky-500/20 via-cyan-400/15 to-blue-500/20",
        "px-1.5 py-0 leading-none text-[10px] font-extrabold tracking-wide",
        "shadow-[0_0_7px_rgba(34,211,238,0.3)]",
        className
      )}
      title="Ultra · 500M quota"
    >
      <span className="ul-sparkle ul-sparkle-1" style={{ top: "-2px", right: "8px" }} />
      <span className="ul-sparkle ul-sparkle-2" style={{ top: "0px", left: "6px" }} />

      <Zap
        className="ul-icon-anim relative z-10 h-2.5 w-2.5 text-cyan-600 dark:text-cyan-300"
        strokeWidth={2.6}
        fill="currentColor"
      />
      <span className="relative z-10 bg-gradient-to-r from-sky-700 via-cyan-600 to-blue-600 dark:from-sky-200 dark:via-cyan-200 dark:to-blue-300 bg-clip-text text-transparent">
        ULTRA
      </span>
    </span>
  );
}
