import { config } from "./config.js";

let cachedUpstream: { baseUrl: string; apiKey: string } | null = null;
let upstreamCacheExpiry = 0;
const UPSTREAM_CACHE_MS = 60_000;

export async function getUpstreamConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  if (cachedUpstream && Date.now() < upstreamCacheExpiry) {
    return cachedUpstream;
  }
  const { query } = await import("./db.js");
  const result = await query<{ key: string; value: string }>(
    `select key, value from system_settings where key in ('upstream_base_url', 'upstream_api_key')`
  );
  const map: Record<string, string> = {};
  for (const row of result.rows) map[row.key] = row.value;
  cachedUpstream = {
    baseUrl: map.upstream_base_url ?? config.UPSTREAM_BASE_URL,
    apiKey: map.upstream_api_key ?? config.UPSTREAM_API_KEY
  };
  upstreamCacheExpiry = Date.now() + UPSTREAM_CACHE_MS;
  return cachedUpstream;
}

export function clearUpstreamCache() {
  cachedUpstream = null;
  upstreamCacheExpiry = 0;
}

const MAX_RETRIES = 5;
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
        code: errorCode
      }
    }
  };
}

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number) {
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
      "x-9router-error-code": failure.errorCode
    }
  });
}

export async function callUpstream(path: string, body?: unknown): Promise<UpstreamResult> {
  const upstream = await getUpstreamConfig();
  const base = upstream.baseUrl.replace(/\/$/, "");
  const opts: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${upstream.apiKey}`,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  };

  let lastResponse: Response | null = null;
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}${path}`, opts, config.UPSTREAM_TIMEOUT_MS);
    } catch (error) {
      return failureForFetchError(error);
    }

    if (!isRetriableStatus(response.status)) {
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return { statusCode: response.status, body: json };
    }

    lastResponse = response;
    // Consume body to free connection
    await response.text();

    if (attempt < MAX_RETRIES) {
      await sleep(delay);
      delay *= BACKOFF_MULTIPLIER;
    }
  }

  // All retries exhausted, return last 429 response
  return { statusCode: lastResponse!.status, body: { error: { message: "Too many requests (upstream)", code: "rate_limit_exceeded" } } };
}

export async function streamUpstream(path: string, body: unknown) {
  const upstream = await getUpstreamConfig();
  const base = upstream.baseUrl.replace(/\/$/, "");
  const opts: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${upstream.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };

  let lastResponse: Response | null = null;
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}${path}`, opts, config.UPSTREAM_STREAM_CONNECT_TIMEOUT_MS);
    } catch (error) {
      return failureResponse(failureForFetchError(error));
    }

    if (!isRetriableStatus(response.status)) {
      return response;
    }

    lastResponse = response;
    // Consume body to free connection
    await response.text();

    if (attempt < MAX_RETRIES) {
      await sleep(delay);
      delay *= BACKOFF_MULTIPLIER;
    }
  }

  // All retries exhausted, return a fresh 429 response because retry bodies were consumed.
  return new Response(
    JSON.stringify({ error: { message: "Too many requests (upstream)", code: "rate_limit_exceeded" } }),
    {
      status: lastResponse!.status,
      headers: {
        "content-type": "application/json",
        "x-9router-error-code": "upstream_error"
      }
    }
  );
}

export async function fetchUpstreamModels() {
  return callUpstream("/models");
}
