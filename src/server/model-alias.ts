const BRAND_PREFIX = "routers9/";

const PUBLIC_MODEL_ALLOWLIST = [/^routers9\/.+/];

const UPSTREAM_MODEL_ALLOWLIST = [/^(?!.*\.\.)(?!routers9\/)[A-Za-z0-9][A-Za-z0-9._\/:\\-]*$/];

// Short provider/channel prefixes that should not appear in human display names.
const STRIP_DISPLAY_PREFIXES = new Set(["ag", "hs", "op", "sf", "kr", "brand", "cc"]);

const DISPLAY_TOKEN_OVERRIDES: Record<string, string> = {
  gpt: "GPT",
  xs: "XS",
  xl: "XL",
  stepfun: "StepFun",
  tencent: "Tencent",
  poolside: "Poolside",
  laguna: "Laguna",
  hy3: "Hy3",
  agnes: "Agnes",
  flash: "Flash",
  grok: "Grok",
  claude: "Claude",
  opus: "Opus",
  fable: "Fable",
  max: "Max",
};

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
  if (stripped.startsWith("routers9/") || stripped.startsWith("brand/")) return stripped;
  // Strip a trailing ":free" tag so the public model id stays clean
  // (e.g. op/tencent/hy3:free -> routers9/op/tencent/hy3). The upstream_model
  // itself is kept intact so proxying to the upstream is unaffected.
  const cleaned = stripped.replace(/:free$/i, "");
  return `${BRAND_PREFIX}${cleaned}`;
}

export function displayNameForModel(modelId: string) {
  let stripped = modelId
    .replace(/^kr\//, "")
    .replace(/^routers9\//, "")
    .replace(/^brand\//, "")
    .replace(/:free$/i, "");

  // Drop short channel prefixes like ag/, hs/ so names don't become "Ag Agnes..." / "Hs Tencent..."
  const firstSlash = stripped.indexOf("/");
  if (firstSlash > 0) {
    const head = stripped.slice(0, firstSlash).toLowerCase();
    if (STRIP_DISPLAY_PREFIXES.has(head)) {
      stripped = stripped.slice(firstSlash + 1);
    }
  }

  return stripped
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (DISPLAY_TOKEN_OVERRIDES[lower]) return DISPLAY_TOKEN_OVERRIDES[lower];
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
