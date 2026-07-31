import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

/**
 * Consistent page header: title + subtitle on the left, action buttons on the right.
 * Keeps every admin page visually aligned (same size, spacing, divider).
 */
export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-border">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
