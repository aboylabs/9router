/**
 * Name-match privileged buyer roles + model access roles.
 * Keep in sync with admin React helpers in client/src/lib/utils.ts
 * and publicDashboardPage() in server/index.ts.
 */

export const SUPER_ADMIN_NAME = "super admin";

/** Supporter / donatur roster (lowercase). Extend when promoting someone. */
export const SUPPORTER_NAMES = ["gilbert arias", "yuop", "attta rebelution", "aditya sandy"] as const;

/** Helper / builder roster (lowercase). Not auto-granted restricted models. */
export const HELPER_NAMES = [] as const;

/** Per-model access roles that can be toggled independently in Models menu. */
export const MODEL_ACCESS_ROLES = ["dev", "supporter", "ultra"] as const;
export type ModelAccessRole = (typeof MODEL_ACCESS_ROLES)[number];

/** Exact 500M lifetime quota → Ultra tier (create-key Ultra package). */
export const ULTRA_QUOTA_TOKENS = 500_000_000;

export function normalizeBuyerName(name: string | null | undefined): string {
  return (name || "").trim().toLowerCase();
}

export function isSuperAdminName(name: string | null | undefined): boolean {
  return normalizeBuyerName(name) === SUPER_ADMIN_NAME;
}

export function isSupporterName(name: string | null | undefined): boolean {
  return (SUPPORTER_NAMES as readonly string[]).includes(normalizeBuyerName(name));
}

export function isHelperName(name: string | null | undefined): boolean {
  return (HELPER_NAMES as readonly string[]).includes(normalizeBuyerName(name));
}

/** Dev (Super Admin) + Supporter — legacy privileged check. */
export function isPrivilegedBuyerName(name: string | null | undefined): boolean {
  return isSuperAdminName(name) || isSupporterName(name);
}

export function isModelAccessRole(value: string): value is ModelAccessRole {
  return (MODEL_ACCESS_ROLES as readonly string[]).includes(value);
}

export function normalizeAccessRoles(roles: unknown): ModelAccessRole[] {
  if (!Array.isArray(roles)) return [];
  const out: ModelAccessRole[] = [];
  for (const raw of roles) {
    const role = String(raw || "").trim().toLowerCase();
    if (isModelAccessRole(role) && !out.includes(role)) out.push(role);
  }
  // stable order for UI/public badges
  return MODEL_ACCESS_ROLES.filter((r) => out.includes(r));
}

export function isRestrictedAccessRoles(roles: unknown): boolean {
  return normalizeAccessRoles(roles).length > 0;
}
