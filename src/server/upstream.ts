import { config } from "./config.js";

// --- Multi-upstream types ---
export type Upstream = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  weight: number;
};

let cachedUpstreams: Upstream[] | null = null;
let upstreamCacheExpiry = 0;
const UPSTREAM_CACHE_MS = 30_000; // 30s cache

// Round-robin index (per-process, resets on restart — acceptable)
let roundRobinIndex = 0;

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
    weight: number;
  }>(`SELECT id, name, base_url, api_key, is_active, weight FROM upstreams ORDER BY created_at ASC`);

  // Fallback: if no upstreams in DB, use legacy system_settings / env config
  if (result.rows.length === 0) {
    const legacyResult = await query<{ key: string; value: string }>(
      `SELECT key, value FROM system_settings WHERE key IN ('upstream_base_url', 'upstream_api_key')`
    );
    const map: Record<string, string> = {};
    for (const row of legacyResult.rows) map[row.key] = row.value;
    const baseUrl = map.upstream_base_url ?? config.UPSTREAM_BASE_URL;
    const apiKey = map.upstream_api_key ?? config.UPSTREAM_API_KEY;
    cachedUpstreams = [{ id: "legacy", name: "Default", baseUrl, apiKey, isActive: true, weight: 1 }];
  } else {
    cachedUpstreams = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      baseUrl: r.base_url,
      apiKey: r.api_key,
      isActive: r.is_active,
      weight: r.weight,
    }));
  }

  upstreamCacheExpiry = Date.now() + UPSTREAM_CACHE_MS;
  return cachedUpstreams;
}

/** Get active upstreams for round-robin selection */
async function getActiveUpstreams(): Promise<Upstream[]> {
  const all = await getUpstreams();
  const active = all.filter((u) => u.isActive);
  if (active.length === 0) {
    throw new Error("No active upstreams configured");
  }
  return active;
}

/** Pick next upstream via weighted round-robin */
async function pickUpstream(excludeIds?: Set<string>): Promise<Upstream> {
  const active = await getActiveUpstreams();
  const candidates = excludeIds ? active.filter((u) => !excludeIds.has(u.id)) : active;
  if (candidates.length === 0) {
    throw new Error("All upstreams failed or no active upstreams");
  }

  // Weighted round-robin: build expanded list based on weight
  const expanded: Upstream[] = [];
  for (const u of candidates) {
    for (let i = 0; i < u.weight; i++) {
      expanded.push(u);
    }
  }

  const pick = expanded[roundRobinIndex % expanded.length];
  roundRobinIndex = (roundRobinIndex + 1) % expanded.length;
  return pick;
}

/** Backward-compat: get single upstream config (for legacy code paths) */
export async function getUpstreamConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const upstream = await pickUpstream();
  return { baseUrl: upstream.baseUrl, apiKey: upstream.apiKey };
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
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("Headers Timeout Error"));
}

function isConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET|socket|connection/i.test(message);
}

function upstreamFailure(statusCode: number, errorCode: UpstreamFailureCode, message: string): UpstreamFailure {
  return {
    statusCode,
    errorCode,
    body: {
      error: {
        message,
        code: errorCode,
      },
    },
  };
}

function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return fetch(url, { ...opts, signal: controller.signal });
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
  body?: unknown
): Promise<UpstreamResult & { retriable: boolean }> {
  const base = upstream.baseUrl.replace(/\/$/, "");
  const opts: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${upstream.apiKey}`,
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
      return { ...failureForFetchError(error), retriable: true, upstreamName: upstream.name };
    }

    if (!isRetriableStatus(response.status)) {
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return { statusCode: response.status, body: json, retriable: false, upstreamName: upstream.name };
    }

    // Consumable 429/5xx — retry on same upstream
    await response.text();
    if (attempt < MAX_RETRIES) {
      await sleep(delay);
      delay *= BACKOFF_MULTIPLIER;
    }
  }

  // All retries on this upstream exhausted — mark as retriable so caller tries next
  return {
    statusCode: 429,
    body: { error: { message: "Too many requests (upstream)", code: "rate_limit_exceeded" } },
    retriable: true,
    upstreamName: upstream.name,
  };
}

export async function callUpstream(path: string, body?: unknown): Promise<UpstreamResult> {
  const triedIds = new Set<string>();

  // Try up to N upstreams with failover
  const active = await getActiveUpstreams();
  const maxAttempts = active.length;

  for (let i = 0; i < maxAttempts; i++) {
    const upstream = await pickUpstream(triedIds);
    triedIds.add(upstream.id);

    const result = await callSingleUpstream(upstream, path, body);
    if (!result.retriable) {
      return { statusCode: result.statusCode, body: result.body, upstreamName: result.upstreamName };
    }

    // Retriable failure — try next upstream
    if (i === maxAttempts - 1) {
      return {
        statusCode: result.statusCode,
        body: result.body,
        errorCode: result.errorCode,
        upstreamName: result.upstreamName,
      };
    }
  }

  return {
    statusCode: 502,
    body: { error: { message: "All upstreams failed", code: "all_upstreams_failed" } },
  };
}

async function streamSingleUpstream(upstream: Upstream, path: string, body: unknown): Promise<{
  response: Response | null;
  failure: UpstreamFailure | null;
  upstreamName: string;
}> {
  const base = upstream.baseUrl.replace(/\/$/, "");
  const opts: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${upstream.apiKey}`,
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
      return { response: null, failure: failureForFetchError(error), upstreamName: upstream.name };
    }

    if (!isRetriableStatus(response.status)) {
      return { response, failure: null, upstreamName: upstream.name };
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
  };
}

export async function streamUpstream(path: string, body: unknown) {
  const triedIds = new Set<string>();
  const active = await getActiveUpstreams();
  const maxAttempts = active.length;

  let lastFailure: UpstreamFailure | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const upstream = await pickUpstream(triedIds);
    triedIds.add(upstream.id);

    const result = await streamSingleUpstream(upstream, path, body);
    if (result.response) {
      // Add header indicating which upstream was used
      const headers = new Headers(result.response.headers);
      headers.set("x-9router-upstream", result.upstreamName);
      return new Response(result.response.body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers,
      });
    }

    lastFailure = result.failure;
    // Try next upstream
  }

  // All upstreams failed
  return failureResponse(lastFailure ?? upstreamFailure(502, "upstream_connection_error", "All upstreams failed"));
}

export async function fetchUpstreamModels(upstreamId?: string) {
  if (upstreamId) {
    const all = await getUpstreams();
    const target = all.find((u) => u.id === upstreamId);
    if (!target) {
      return { statusCode: 404, body: { error: { message: "Upstream not found", code: "not_found" } } };
    }
    const base = target.baseUrl.replace(/\/$/, "");
    try {
      const response = await fetchWithTimeout(
        `${base}/models`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${target.apiKey}`, "content-type": "application/json" },
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
