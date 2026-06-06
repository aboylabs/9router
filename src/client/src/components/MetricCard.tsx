import { cn } from "../lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  className?: string;
}

export function MetricCard({ label, value, icon, className }: MetricCardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</span>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-text-primary">{typeof value === "number" ? value.toLocaleString() : value}</p>
    </div>
  );
}
