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

export function formatLastActive(date: string | Date | null): string {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";

  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const targetDateStr = dateFmt.format(d);
  const todayDateStr = dateFmt.format(new Date());
  const timeStr = timeFmt.format(d);

  const [tY, tM, tD] = targetDateStr.split("-").map(Number);
  const [nowY, nowM, nowD] = todayDateStr.split("-").map(Number);

  const targetUtc = Date.UTC(tY, tM - 1, tD);
  const todayUtc = Date.UTC(nowY, nowM - 1, nowD);
  const diffDays = Math.round((todayUtc - targetUtc) / 86400000);

  if (diffDays <= 0) {
    return timeStr;
  }
  if (diffDays === 1) {
    return `Yesterday, ${timeStr}`;
  }
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = monthNames[tM - 1] || String(tM);
  if (tY !== nowY) {
    return `${tD} ${monthName} ${tY}, ${timeStr}`;
  }
  return `${tD} ${monthName}, ${timeStr}`;
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
 * Name-match list (extend as needed).
 */
export const SUPPORTER_NAMES = new Set(["attta rebelution", "aditya sandy", "dono", "dna", "brother rogers", "ichigo kurosaki", "#indopride", "blue", "mrians21", "khd", "snapt", "ramses", "binkhozin", "el", "company belanda", "petapagenit", "cucakrowo", "octav", "0xfz", "nyguist"]);

export function isSupporterName(name: string | null | undefined, accessRoles?: string[] | null): boolean {
  if (isSuperAdminName(name, accessRoles)) return false;
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
export function isUltraKey(isUltra?: boolean | null, quotaTokens?: number | string | null, accessRoles?: string[] | null): boolean {
  if (Array.isArray(accessRoles)) {
    return accessRoles.includes("ultra");
  }
  if (isUltra === true) return true;
  return isUltraQuota(quotaTokens);
}

/** Pro role — per-key access_roles column only (no name-match roster). */
export function isProKey(accessRoles?: string[] | null): boolean {
  return Array.isArray(accessRoles) && accessRoles.includes("pro");
}

/**
 * Buyer name text color by role/quota tier:
 * Super Admin gradient purple/pink glow >
 * Supporter bright yellow glow >
 * Helper emerald glow >
 * ULTRA 500M cyan glow > 250M light green > default
 */
export function buyerNameClassName(
  name?: string | null,
  _quotaTokens?: number | string | null,
  _isUltra?: boolean | null,
  accessRoles?: string[] | null
): string {
  if (isSuperAdminName(name, accessRoles)) {
    return "text-red-500 font-bold dark:text-red-400";
  }
  return "text-text-primary";
}

export function roleRowClassName(
  _name?: string | null,
  _quotaTokens?: number | string | null,
  _isUltra?: boolean | null,
  _accessRoles?: string[] | null
): string {
  return "";
}
