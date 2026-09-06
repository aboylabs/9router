import { Zap } from "lucide-react";
import { cn } from "../lib/utils";

export function UltraBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-cyan-400/35",
        "bg-cyan-500/15 px-1.5 py-0 leading-none text-[10px] font-semibold tracking-wide",
        "text-cyan-200",
        className
      )}
      title="Ultra · 500M quota"
    >
      <Zap className="h-2.5 w-2.5" strokeWidth={2.6} fill="currentColor" />
      ULTRA
    </span>
  );
}
