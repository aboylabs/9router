import type { ReactNode, TdHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface TableProps {
  className?: string;
  children: ReactNode;
}

export function Table({ className, children }: TableProps) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
      <table className={cn("w-full text-sm border-collapse", className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-surface-secondary/95 border-b border-border sticky top-0 z-10 backdrop-blur-sm">
      {children}
    </thead>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TableRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn("hover:bg-surface-secondary/60 transition-colors", className)}>
      {children}
    </tr>
  );
}

export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap",
        className
      )}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-3 py-3 text-text-secondary whitespace-nowrap", className)} {...props}>
      {children}
    </td>
  );
}

export function TableEmpty({ colSpan, message }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-text-muted text-sm">
        {message || "No data available"}
      </td>
    </tr>
  );
}
