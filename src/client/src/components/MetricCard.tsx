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
        "relative overflow-hidden rounded-lg border border-border bg-surface p-4",
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary text-text-secondary">
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
