import { HeartHandshake } from "lucide-react";
import { cn } from "../lib/utils";

/** Premium supporter/donatur chip — animated yellow glow + sparkles (admin panel). */
export function SupporterBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "sp-badge-anim inline-flex items-center gap-1 shrink-0",
        "rounded-md border border-yellow-400/50",
        "bg-gradient-to-r from-yellow-400/25 via-amber-300/20 to-yellow-500/25",
        "px-1.5 py-0 leading-none text-[10px] font-extrabold tracking-wide",
        "shadow-[0_0_6px_rgba(250,204,21,0.3)]",
        className
      )}
      title="Supporter · Donatur (unlimited · no expiry)"
    >
      <span className="sp-sparkle sp-sparkle-1" style={{ top: "-2px", right: "8px" }} />
      <span className="sp-sparkle sp-sparkle-2" style={{ top: "0px", left: "6px" }} />

      <HeartHandshake
        className="sp-icon-anim relative z-10 h-2.5 w-2.5 text-amber-600 dark:text-yellow-200"
        strokeWidth={2.4}
      />
      <span className="relative z-10 bg-gradient-to-r from-amber-700 via-yellow-600 to-amber-600 dark:from-yellow-100 dark:via-amber-200 dark:to-yellow-300 bg-clip-text text-transparent">
        SUPPORTER
      </span>
    </span>
  );
}
