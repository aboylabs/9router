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

/** Remaining lifetime of a key from expires_at (WIB-facing display). */
export function formatRemaining(expiresAt: string | Date | null | undefined): {
  label: string;
  tone: "ok" | "warn" | "danger" | "muted";
} {
  if (!expiresAt) return { label: "No expiry", tone: "muted" };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return { label: "-", tone: "muted" };
  if (ms <= 0) return { label: "Expired", tone: "danger" };

  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  let label: string;
  if (days >= 1) {
    label = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  } else if (hours >= 1) {
    label = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  } else {
    label = `${Math.max(1, minutes)}m`;
  }

  const tone = days >= 7 ? "ok" : days >= 2 ? "warn" : "danger";
  return { label: `${label} left`, tone };
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
export function isSuperAdminName(name: string | null | undefined, accessRoles?: string[] | null): boolean {
  if ((name || "").trim().toLowerCase() === "super admin") return true;
  return Array.isArray(accessRoles) && accessRoles.includes("dev");
}

/**
 * Supporter / donatur buyers — bright yellow name + badge.
 * Name-match list (extend as needed). Currently: GILBERT ARIAS, yuop.
 */
const SUPPORTER_NAMES = new Set(["gilbert arias", "yuop", "attta rebelution", "aditya sandy"]);

export function isSupporterName(name: string | null | undefined, accessRoles?: string[] | null): boolean {
  if (SUPPORTER_NAMES.has((name || "").trim().toLowerCase())) return true;
  return Array.isArray(accessRoles) && accessRoles.includes("supporter");
}

/**
 * Helper / Builder buyers — emerald name + badge (helped build the server).
 * Name-match list (extend as needed). Currently: none.
 */
const HELPER_NAMES = new Set<string>([]);

export function isHelperName(name: string | null | undefined, accessRoles?: string[] | null): boolean {
  if (HELPER_NAMES.has((name || "").trim().toLowerCase())) return true;
  return Array.isArray(accessRoles) && accessRoles.includes("helper");
}

/** Known product token quotas (exact match). */
export const QUOTA_500M = 500_000_000;
export const QUOTA_250M = 250_000_000;

/** Exact 500M lifetime quota → ULTRA tier badge (legacy quota-based check). */
export function isUltraQuota(quotaTokens?: number | string | null): boolean {
  if (quotaTokens == null || quotaTokens === "") return false;
  const q = Number(quotaTokens);
  return Number.isFinite(q) && q === QUOTA_500M;
}

/** Ultra tier from dedicated is_ultra flag, falling back to legacy 500M quota. */
export function isUltraKey(isUltra?: boolean | null, quotaTokens?: number | string | null): boolean {
  if (isUltra === true) return true;
  return isUltraQuota(quotaTokens);
}

/**
 * Buyer name text color by role/quota tier:
 * Super Admin gradient purple/pink glow >
 * Supporter bright yellow glow >
 * Helper emerald glow >
 * ULTRA 500M cyan glow > 250M light green > default
 */
export function buyerNameClassName(
  name: string | null | undefined,
  quotaTokens?: number | string | null,
  isUltra?: boolean | null,
  accessRoles?: string[] | null
): string {
  if (isSuperAdminName(name, accessRoles)) {
    return [
      "font-semibold",
      "sa-name-anim",
    ].join(" ");
  }
  if (isSupporterName(name, accessRoles)) {
    return [
      "font-semibold",
      "sp-name-anim",
    ].join(" ");
  }
  if (isHelperName(name, accessRoles)) {
    return [
      "font-semibold",
      "bg-gradient-to-r from-emerald-600 via-teal-500 to-green-600",
      "dark:from-emerald-200 dark:via-teal-200 dark:to-green-300",
      "bg-clip-text text-transparent",
      "drop-shadow-[0_0_10px_rgba(52,211,153,0.45)]",
    ].join(" ");
  }
  if (isUltraKey(isUltra, quotaTokens)) {
    return [
      "font-semibold",
      "ul-name-anim",
    ].join(" ");
  }
  if (quotaTokens == null || quotaTokens === "") return "text-text-primary";
  const q = Number(quotaTokens);
  if (!Number.isFinite(q)) return "text-text-primary";
  if (q === QUOTA_250M) return "text-emerald-600 dark:text-emerald-300 font-semibold";
  return "text-text-primary";
}

/**
 * Row-level highlight class for special roles.
 * Returns the appropriate CSS class for Super Admin / Supporter / Ultra rows,
 * or empty string for normal rows.
 */
export function roleRowClassName(
  name: string | null | undefined,
  quotaTokens?: number | string | null,
  isUltra?: boolean | null,
  accessRoles?: string[] | null
): string {
  if (isSuperAdminName(name, accessRoles)) return "sa-row-highlight";
  if (isSupporterName(name, accessRoles)) return "sp-row-highlight";
  if (isHelperName(name, accessRoles)) return ""; // helper — no row highlight for now
  if (isUltraKey(isUltra, quotaTokens)) return "ul-row-highlight";
  return "";
}
