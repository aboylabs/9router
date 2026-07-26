import { cn } from "../../lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-surface-tertiary text-text-secondary",
        success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500/15",
        warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 ring-1 ring-amber-500/15",
        danger: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 ring-1 ring-red-500/15",
        info: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 ring-1 ring-blue-500/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string;
  children: React.ReactNode;
}

export function Badge({ className, variant, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {children}
    </span>
  );
}
