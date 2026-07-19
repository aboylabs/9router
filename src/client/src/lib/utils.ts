import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateMY(date: string | Date | null): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }) + " (WIB)";
}

export function formatDateShort(date: string | Date | null): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  });
}

export function formatNumber(value: number | string): string {
  return Number(value).toLocaleString();
}

/**
 * Format token count (e.g., 200000000 → "200M")
 */
export function formatTokens(value: number | string): string {
  const num = Number(value);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toString();
}

/** Super Admin buyer — purple name styling across admin UI */
export function isSuperAdminName(name: string | null | undefined): boolean {
  return (name || "").trim().toLowerCase() === "super admin";
}

/** Buyer name text color: Super Admin purple > VIP yellow > default */
export function buyerNameClassName(name: string | null | undefined, isVip?: boolean): string {
  if (isSuperAdminName(name)) return "text-purple-400 font-semibold";
  if (isVip) return "text-yellow-500";
  return "text-text-primary";
}
