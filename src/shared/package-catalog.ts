/**
 * Paid create-key packages — aligned with public Prices tab
 * (Starter / Pro / Business / Ultra). Used by admin Create API Key.
 * Supporter is name/DB promote, not in this create form.
 */
export const CREATE_KEY_PACKAGES = [
  {
    id: "starter",
    label: "Starter",
    priceRp: 150_000,
    quotaTokens: 150_000_000,
    rateLimitRpm: 10,
    defaultDays: 28,
  },
  {
    id: "pro",
    label: "Pro",
    priceRp: 300_000,
    quotaTokens: 300_000_000,
    rateLimitRpm: 25,
    defaultDays: 28,
  },
  {
    id: "ultra",
    label: "Ultra",
    priceRp: 500_000,
    quotaTokens: 500_000_000,
    rateLimitRpm: 50,
    defaultDays: 28,
  },
] as const;

export type CreateKeyPackage = (typeof CREATE_KEY_PACKAGES)[number];
export type CreateKeyPackageId = CreateKeyPackage["id"];

export const DEFAULT_CREATE_KEY_PACKAGE_ID: CreateKeyPackageId = "starter";

export const CREATE_KEY_PACKAGE_IDS = [
  "starter",
  "pro",
  "ultra",
] as const satisfies readonly CreateKeyPackageId[];

export const CREATE_KEY_PACKAGES_BY_ID = Object.fromEntries(
  CREATE_KEY_PACKAGES.map((pkg) => [pkg.id, pkg]),
) as Record<CreateKeyPackageId, CreateKeyPackage>;

export function createKeyPackageForId(
  packageId: string | null | undefined,
): CreateKeyPackage | undefined {
  if (!packageId) return undefined;
  return CREATE_KEY_PACKAGES_BY_ID[packageId as CreateKeyPackageId];
}

/** Legacy buyer-package presets (sales/history). Separate from create-key paid tiers. */
export const PRESET_PACKAGES = [
  {
    id: "paket_a_2w",
    label: "Paket A - RP 100K (2 Minggu)",
    badge: "A",
    priceRp: 100_000,
    quotaTokens: null,
    expiryHours: 336,
    dailyReset: false,
    dailyQuotaTokens: null,
    quotaDisplay: "Unlimited",
    expiryDisplay: "2 minggu",
    resetDisplay: null,
  },
  {
    id: "paket_b_1m",
    label: "Paket B - RP 150K (1 Bulan)",
    badge: "B",
    priceRp: 150_000,
    quotaTokens: null,
    expiryHours: 720,
    dailyReset: false,
    dailyQuotaTokens: null,
    quotaDisplay: "Unlimited",
    expiryDisplay: "1 bulan",
    resetDisplay: null,
  },
] as const;

export type PresetPackage = (typeof PRESET_PACKAGES)[number];
export type PresetPackageId = PresetPackage["id"];
export type SalesBucket = "a" | "b";

export const DEFAULT_PACKAGE_ID: PresetPackageId = "paket_a_2w";

export const CREATABLE_PACKAGE_IDS = [
  "paket_a_2w",
  "paket_b_1m",
] as const;

export const PRESET_PACKAGES_BY_ID = Object.fromEntries(
  PRESET_PACKAGES.map((pkg) => [pkg.id, pkg]),
) as Record<PresetPackageId, PresetPackage>;

export const CREATABLE_PACKAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PRESET_PACKAGES.map((pkg) => [pkg.id, pkg.label])),
};

const LEGACY_PACKAGE_PRICES: Record<string, number> = {
  rm10_200m_48h: 11,
  rm11_224m_48h: 11,
  rm15_200m_3d: 15,
  rm15_200m_7d: 14,
  rm20_200m_5d: 20,
  rm20_50m_7d_daily: 20,
};

export function presetPackageForId(packageId: string): PresetPackage | undefined {
  return PRESET_PACKAGES_BY_ID[packageId as PresetPackageId];
}

export function displayPackageLabel(
  packageId: string | null | undefined,
  storedLabel?: string | null,
): string | null {
  if (!packageId) return storedLabel ?? null;

  return (
    presetPackageForId(packageId)?.label ??
    CREATABLE_PACKAGE_LABELS[packageId] ??
    storedLabel ??
    packageId
  );
}

export function packageBadgeForId(packageId: string | null | undefined): string | null {
  if (!packageId) return "Legacy";
  return presetPackageForId(packageId)?.badge ?? "Legacy";
}

export function salesBucketForPackageId(packageId: string | null): SalesBucket | null {
  const preset = packageId ? presetPackageForId(packageId) : undefined;
  return preset ? preset.badge.toLowerCase() as SalesBucket : null;
}

export function salesPriceForPackageId(packageId: string | null): number {
  if (!packageId) return 0;
  return presetPackageForId(packageId)?.priceRp ?? LEGACY_PACKAGE_PRICES[packageId] ?? 0;
}
