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
        "rounded-xl border border-border bg-surface p-4 shadow-sm",
        "hover:border-border-hover transition-colors",
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
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
