const BRAND_PREFIX = "9router/";

const PUBLIC_MODEL_ALLOWLIST = [/^9router\/.+/];

const UPSTREAM_MODEL_ALLOWLIST = [/^(?!.*\.\.)(?!9router\/)[A-Za-z0-9][A-Za-z0-9._\/:\\-]*$/];

export function isBrandedModelId(modelId: string) {
  return modelId.startsWith(BRAND_PREFIX) || modelId.startsWith("brand/");
}

export function isAllowedPublicModelId(modelId: string) {
  return PUBLIC_MODEL_ALLOWLIST.some((pattern) => pattern.test(modelId));
}

export function isAllowedUpstreamModelId(modelId: string) {
  return UPSTREAM_MODEL_ALLOWLIST.some((pattern) => pattern.test(modelId));
}

export function aliasForUpstreamModel(upstreamModel: string) {
  const stripped = upstreamModel.startsWith("kr/") ? upstreamModel.slice(3) : upstreamModel;
  if (stripped.startsWith("9router/") || stripped.startsWith("brand/")) return stripped;
  // Strip a trailing ":free" tag so the public model id stays clean
  // (e.g. op/tencent/hy3:free -> 9router/op/tencent/hy3). The upstream_model
  // itself is kept intact so proxying to the upstream is unaffected.
  const cleaned = stripped.replace(/:free$/i, "");
  return `${BRAND_PREFIX}${cleaned}`;
}

export function displayNameForModel(modelId: string) {
  const stripped = modelId
    .replace(/^kr\//, "")
    .replace(/^9router\//, "")
    .replace(/^brand\//, "");

  return stripped
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      if (part.toLowerCase() === "gpt") return "GPT";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
