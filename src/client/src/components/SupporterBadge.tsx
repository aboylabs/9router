import { HeartHandshake } from "lucide-react";
import { cn } from "../lib/utils";

export function SupporterBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md border border-yellow-400/35",
        "bg-yellow-500/15 px-1.5 py-0 leading-none text-[10px] font-semibold tracking-wide",
        "text-yellow-200",
        className
      )}
      title="Supporter · Donatur (unlimited · no expiry)"
    >
      <HeartHandshake className="h-2.5 w-2.5" strokeWidth={2.4} />
      SUPPORTER
    </span>
  );
}
