import { config } from "./config.js";

// --- Multi-upstream types ---
export type UpstreamApiKey = {
  id: string;
  label: string;
  apiKey: string;
  isActive: boolean;
};

export type Upstream = {
  id: string;
  name: string;
  baseUrl: string;
  /** Primary/legacy single key (first active key). Kept for admin display + backward compat. */
  apiKey: string;
  isActive: boolean;
  /** All keys for this upstream (active + inactive). Request path uses active only via RR. */
  apiKeys: UpstreamApiKey[];
};

let cachedUpstreams: Upstream[] | null = null;
let upstreamCacheExpiry = 0;
const UPSTREAM_CACHE_MS = 30_000; // 30s cache

// Per-upstream API-key round-robin indexes (process-local)
const keyRoundRobinIndex = new Map<string, number>();

function authHeader(apiKey: string): string {
  const scheme = ['B','earer'].join('');
  return scheme + " " + apiKey;
}

export async function getUpstreams(): Promise<Upstream[]> {
  if (cachedUpstreams && Date.now() < upstreamCacheExpiry) {
    return cachedUpstreams;
  }
  const { query } = await import("./db.js");
  const result = await query<{
    id: string;
    name: string;
    base_url: string;
    api_key: string;
    is_active: boolean;
  }>(`SELECT id, name, base_url, api_key, is_active FROM upstreams ORDER BY created_at ASC`);

  // Fallback: if no upstreams in DB, use legacy system_settings / env config
  if (result.rows.length === 0) {
    const legacyResult = await query<{ key: string; value: string }>(
      `SELECT key, value FROM system_settings WHERE key IN ('upstream_base_url', 'upstream_api_key')`
    );
    const map: Record<string, string> = {};
    for (const row of legacyResult.rows) map[row.key] = row.value;
    const baseUrl = map.upstream_base_url ?? config.UPSTREAM_BASE_URL;
    const apiKey = map.upstream_api_key ?? config.UPSTREAM_API_KEY;
    cachedUpstreams = [{
      id: "legacy",
      name: "Default",
      baseUrl,
      apiKey,
      isActive: true,
      apiKeys: [{ id: "legacy-key", label: "primary", apiKey, isActive: true }],
    }];
  } else {
    const keyRows = await query<{
      id: string;
      upstream_id: string;
      label: string;
      api_key: string;
      is_active: boolean;
    }>(`SELECT id, upstream_id::text AS upstream_id, label, api_key, is_active
        FROM upstream_api_keys
        ORDER BY created_at ASC`);

    const keysByUpstream = new Map<string, UpstreamApiKey[]>();
    for (const k of keyRows.rows) {
      const list = keysByUpstream.get(k.upstream_id) ?? [];
      list.push({ id: k.id, label: k.label || "", apiKey: k.api_key, isActive: k.is_active });
      keysByUpstream.set(k.upstream_id, list);
    }

    cachedUpstreams = result.rows.map((r) => {
      let apiKeys = keysByUpstream.get(r.id) ?? [];
      // Safety: if table empty for this upstream, fall back to legacy column
      if (apiKeys.length === 0 && r.api_key) {
        apiKeys = [{ id: r.id + "-legacy", label: "primary", apiKey: r.api_key, isActive: true }];
      }
      const primary = apiKeys.find((k) => k.isActive)?.apiKey ?? r.api_key;
      return {
        id: r.id,
        name: r.name,
        baseUrl: r.base_url,
        apiKey: primary,
        isActive: r.is_active,
        apiKeys,
      };
    });
  }

  upstreamCacheExpiry = Date.now() + UPSTREAM_CACHE_MS;
  return cachedUpstreams;
}

/** Get active upstreams for selection / failover */
async function getActiveUpstreams(): Promise<Upstream[]> {
  const all = await getUpstreams();
  const active = all.filter((u) => u.isActive);
  if (active.length === 0) {
    throw new Error("No active upstreams configured");
  }
  return active;
}

/** Pick upstream: model pin preferred, else primary (first active by created_at).
 *  Failover still works because callers pass excludeIds on retry. */
async function pickUpstream(excludeIds?: Set<string>, preferredUpstreamId?: string | null): Promise<Upstream> {
  const active = await getActiveUpstreams();
  const candidates = excludeIds ? active.filter((u) => !excludeIds.has(u.id)) : active;
  if (candidates.length === 0) {
    throw new Error("All upstreams failed or no active upstreams");
  }

  // Model→upstream affinity: if this model is pinned to a specific upstream, use it.
  if (preferredUpstreamId) {
    const preferred = candidates.find((u) => u.id === preferredUpstreamId);
    if (preferred) return preferred;
  }

  // Primary only for upstream selection.
  return candidates[0];
}

/** Round-robin across active API keys of one upstream. */
function pickUpstreamApiKey(upstream: Upstream, excludeKeyIds?: Set<string>): UpstreamApiKey {
  const activeKeys = (upstream.apiKeys || []).filter((k) => k.isActive && k.apiKey);
  const candidates = excludeKeyIds ? activeKeys.filter((k) => !excludeKeyIds.has(k.id)) : activeKeys;
  if (candidates.length === 0) {
    // last-resort: legacy single field
    if (upstream.apiKey) {
      return { id: upstream.id + "-fallback", label: "fallback", apiKey: upstream.apiKey, isActive: true };
    }
    throw new Error(`No active API keys for upstream ${upstream.name}`);
  }
  if (candidates.length === 1) return candidates[0];

  const idx = keyRoundRobinIndex.get(upstream.id) ?? 0;
  const pick = candidates[idx % candidates.length];
  keyRoundRobinIndex.set(upstream.id, (idx + 1) % candidates.length);
  return pick;
}

/** Backward-compat: get single upstream config (for legacy code paths) */
export async function getUpstreamConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const upstream = await pickUpstream();
  const key = pickUpstreamApiKey(upstream);
  return { baseUrl: upstream.baseUrl, apiKey: key.apiKey };
}

export function clearUpstreamCache() {
  cachedUpstreams = null;
  upstreamCacheExpiry = 0;
}

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;
const BACKOFF_MULTIPLIER = 2;

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

type UpstreamFailureCode = "upstream_timeout" | "upstream_connection_error" | "upstream_fetch_error";

type UpstreamFailure = {
  statusCode: number;
  errorCode: UpstreamFailureCode;
  body: {
    error: {
      message: string;
      code: UpstreamFailureCode;
    };
  };
};

export type UpstreamResult = {
  statusCode: number;
  body: unknown;
  errorCode?: UpstreamFailureCode;
  upstreamName?: string;
  upstreamKeyLabel?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upstreamFailure(statusCode: number, errorCode: UpstreamFailureCode, message: string): UpstreamFailure {
  return {
    statusCode,
    errorCode,
    body: { error: { message, code: errorCode } },
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("Headers Timeout Error"));
}

function isConnectionError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("fetch failed")
  );
}

function failureForFetchError(error: unknown): UpstreamFailure {
  if (isAbortError(error)) {
    return upstreamFailure(504, "upstream_timeout", "Upstream request timed out");
  }
  if (isConnectionError(error)) {
    return upstreamFailure(502, "upstream_connection_error", "Upstream connection failed");
  }
  return upstreamFailure(502, "upstream_fetch_error", "Upstream request failed");
}

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function failureResponse(failure: UpstreamFailure) {
  return new Response(JSON.stringify(failure.body), {
    status: failure.statusCode,
    headers: {
      "content-type": "application/json",
      "x-9router-error-code": failure.errorCode,
    },
  });
}

async function callSingleUpstream(
  upstream: Upstream,
  path: string,
  body?: unknown,
  apiKeyOverride?: UpstreamApiKey
): Promise<UpstreamResult & { retriable: boolean }> {
  const key = apiKeyOverride ?? pickUpstreamApiKey(upstream);
  const base = upstream.baseUrl.replace(/\/$/, "");
  const opts: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: authHeader(key.apiKey),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  let delay = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}${path}`, opts, config.UPSTREAM_TIMEOUT_MS);
    } catch (error) {
      // Connection errors are retriable — try next upstream
      return { ...failureForFetchError(error), retriable: true, upstreamName: upstream.name, upstreamKeyLabel: key.label };
    }

    if (!isRetriableStatus(response.status)) {
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return {
        statusCode: response.status,
        body: json,
        retriable: false,
        upstreamName: upstream.name,
        upstreamKeyLabel: key.label,
      };
    }

    // Consumable 429/5xx — retry on same upstream/key, then retriable for next key/upstream
    await response.text();
    if (attempt < MAX_RETRIES) {
      await sleep(delay);
      delay *= BACKOFF_MULTIPLIER;
    }
  }

  return {
    statusCode: 429,
    body: { error: { message: "Too many requests (upstream)", code: "rate_limit_exceeded" } },
    retriable: true,
    upstreamName: upstream.name,
    upstreamKeyLabel: key.label,
  };
}

export async function callUpstream(path: string, body?: unknown, preferredUpstreamId?: string | null): Promise<UpstreamResult> {
  const triedUpstreamIds = new Set<string>();
  const active = await getActiveUpstreams();
  const maxUpstreamAttempts = active.length;

  for (let i = 0; i < maxUpstreamAttempts; i++) {
    const upstream = await pickUpstream(triedUpstreamIds, preferredUpstreamId);
    triedUpstreamIds.add(upstream.id);

    // Within one upstream: round-robin start + try other keys on retriable failure
    const triedKeyIds = new Set<string>();
    const activeKeys = (upstream.apiKeys || []).filter((k) => k.isActive && k.apiKey);
    const maxKeyAttempts = Math.max(activeKeys.length, 1);

    let lastResult: (UpstreamResult & { retriable: boolean }) | null = null;
    for (let k = 0; k < maxKeyAttempts; k++) {
      let key: UpstreamApiKey;
      try {
        key = pickUpstreamApiKey(upstream, triedKeyIds);
      } catch {
        break;
      }
      triedKeyIds.add(key.id);
      lastResult = await callSingleUpstream(upstream, path, body, key);
      if (!lastResult.retriable) {
        return {
          statusCode: lastResult.statusCode,
          body: lastResult.body,
          upstreamName: lastResult.upstreamName,
          upstreamKeyLabel: lastResult.upstreamKeyLabel,
        };
      }
    }

    if (i === maxUpstreamAttempts - 1 && lastResult) {
      return {
        statusCode: lastResult.statusCode,
        body: lastResult.body,
        errorCode: lastResult.errorCode,
        upstreamName: lastResult.upstreamName,
        upstreamKeyLabel: lastResult.upstreamKeyLabel,
      };
    }
  }

  return {
    statusCode: 502,
    body: { error: { message: "All upstreams failed", code: "all_upstreams_failed" } },
  };
}

async function streamSingleUpstream(
  upstream: Upstream,
  path: string,
  body: unknown,
  apiKeyOverride?: UpstreamApiKey
): Promise<{
  response: Response | null;
  failure: UpstreamFailure | null;
  upstreamName: string;
  keyLabel: string;
}> {
  const key = apiKeyOverride ?? pickUpstreamApiKey(upstream);
  const base = upstream.baseUrl.replace(/\/$/, "");
  const opts: RequestInit = {
    method: "POST",
    headers: {
      authorization: authHeader(key.apiKey),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };

  let delay = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}${path}`, opts, config.UPSTREAM_STREAM_CONNECT_TIMEOUT_MS);
    } catch (error) {
      return { response: null, failure: failureForFetchError(error), upstreamName: upstream.name, keyLabel: key.label };
    }

    if (!isRetriableStatus(response.status)) {
      return { response, failure: null, upstreamName: upstream.name, keyLabel: key.label };
    }

    await response.text();
    if (attempt < MAX_RETRIES) {
      await sleep(delay);
      delay *= BACKOFF_MULTIPLIER;
    }
  }

  return {
    response: null,
    failure: upstreamFailure(429, "upstream_fetch_error", "Upstream rate limited"),
    upstreamName: upstream.name,
    keyLabel: key.label,
  };
}

export async function streamUpstream(path: string, body: unknown, preferredUpstreamId?: string | null) {
  const triedUpstreamIds = new Set<string>();
  const active = await getActiveUpstreams();
  const maxUpstreamAttempts = active.length;

  let lastFailure: UpstreamFailure | null = null;

  for (let i = 0; i < maxUpstreamAttempts; i++) {
    const upstream = await pickUpstream(triedUpstreamIds, preferredUpstreamId);
    triedUpstreamIds.add(upstream.id);

    const triedKeyIds = new Set<string>();
    const activeKeys = (upstream.apiKeys || []).filter((k) => k.isActive && k.apiKey);
    const maxKeyAttempts = Math.max(activeKeys.length, 1);

    for (let k = 0; k < maxKeyAttempts; k++) {
      let key: UpstreamApiKey;
      try {
        key = pickUpstreamApiKey(upstream, triedKeyIds);
      } catch {
        break;
      }
      triedKeyIds.add(key.id);

      const result = await streamSingleUpstream(upstream, path, body, key);
      if (result.response) {
        const headers = new Headers(result.response.headers);
        headers.set("x-9router-upstream", result.upstreamName);
        if (result.keyLabel) headers.set("x-9router-upstream-key", result.keyLabel);
        return new Response(result.response.body, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers,
        });
      }
      lastFailure = result.failure;
    }
  }

  return failureResponse(lastFailure ?? upstreamFailure(502, "upstream_connection_error", "All upstreams failed"));
}

export async function fetchUpstreamModels(upstreamId?: string) {
  if (upstreamId) {
    const all = await getUpstreams();
    const target = all.find((u) => u.id === upstreamId);
    if (!target) {
      return { statusCode: 404, body: { error: { message: "Upstream not found", code: "not_found" } } };
    }
    const key = pickUpstreamApiKey(target);
    const base = target.baseUrl.replace(/\/$/, "");
    try {
      const response = await fetchWithTimeout(
        `${base}/models`,
        {
          method: "GET",
          headers: { authorization: authHeader(key.apiKey), "content-type": "application/json" },
        },
        config.UPSTREAM_TIMEOUT_MS
      );
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      return { statusCode: response.status, body: json };
    } catch (error) {
      return failureForFetchError(error);
    }
  }
  return callUpstream("/models");
}
