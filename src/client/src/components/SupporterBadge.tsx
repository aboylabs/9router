import { HeartHandshake } from "lucide-react";
import { cn } from "../lib/utils";

/** Compact supporter/donatur chip — bright yellow glow (admin panel). */
export function SupporterBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-yellow-400/50",
        "bg-gradient-to-r from-yellow-400/25 via-amber-300/20 to-yellow-500/25",
        "px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider",
        "shadow-[0_0_12px_rgba(250,204,21,0.35)]",
        className
      )}
      title="Supporter · Donatur (unlimited · no expiry)"
    >
      <HeartHandshake className="h-3 w-3 text-amber-600 dark:text-yellow-200" strokeWidth={2.4} />
      <span className="bg-gradient-to-r from-amber-700 via-yellow-600 to-amber-600 dark:from-yellow-100 dark:via-amber-200 dark:to-yellow-300 bg-clip-text text-transparent">
        SUPPORTER
      </span>
    </span>
  );
}
