import { cn } from "../lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricCard({ label, value, icon, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-sm",
        "hover:border-primary-500/40 hover:shadow-md transition-all duration-200",
        className
      )}
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary-500/0 via-primary-500/50 to-primary-500/0 opacity-0 hover:opacity-100 transition-opacity" />
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 ring-1 ring-primary-500/20">
            {icon}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tracking-tight text-text-primary tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
