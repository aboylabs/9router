import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";
import { findApiKey } from "./repositories.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";

// Public endpoints are scrapeable; light per-IP throttle (not for buyer chat).
const publicRateLimiter = new FixedWindowRateLimiter(60_000);
const PUBLIC_RPM = 120;

// --- Viewer gate (Account / Leaderboard / Live require a valid API key once) ---
// Unlock is strictly throttled: a valid key grants panel access, so an unthrottled
// endpoint would double as a key-guessing oracle.
const unlockRateLimiter = new FixedWindowRateLimiter(60_000);
const UNLOCK_ATTEMPTS_PER_MIN = 5;
const VIEWER_COOKIE = "9router_viewer";
const VIEWER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const VIEWER_SECRET_SALT = "revoke_all_20260926";
const viewerSecret = new TextEncoder().encode(config.JWT_SECRET + ":viewer:" + VIEWER_SECRET_SALT);

type ViewerSession = { kh: string; kid: string; name: string; exp?: number; iat?: number };

function viewerKeyFingerprint(key: string): string {
  return crypto.createHash("sha256").update(`viewer:${key}`).digest("hex").slice(0, 32);
}

async function readViewer(request: FastifyRequest): Promise<ViewerSession | null> {
  const token = request.cookies?.[VIEWER_COOKIE];
  if (!token) return null;
  try {
    const verified = await jwtVerify(token, viewerSecret);
    const payload = verified.payload as Partial<ViewerSession>;
    // Cookies minted before the Account page existed have no `kid`; treat them as
    // valid viewers (kid stays empty) so nobody gets logged out by the upgrade.
    if (!payload.kh) return null;
    return {
      kh: payload.kh,
      kid: String(payload.kid ?? ""),
      name: String(payload.name ?? ""),
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
      iat: typeof payload.iat === "number" ? payload.iat : undefined
    };
  } catch {
    return null;
  }
}

async function requireViewer(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const viewer = await readViewer(request);
  if (viewer) return true;
  reply.code(401).send({
    error: "API key required to view this page",
    code: "unlock_required"
  });
  return false;
}

function maskEmail(email: string): string {
  if (!email) return "hidden";
  const [local, domain] = email.split("@");
  if (!domain) return local.substring(0, 2) + "***";
  return local.substring(0, 1) + "***@" + domain;
}

function clientIp(request: { ip?: string; headers: Record<string, unknown> }): string {
  const xf = request.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(",")[0].trim();
  return request.ip || "unknown";
}

function enforcePublicRateLimit(request: any, reply: any): boolean {
  const ip = clientIp(request);
  const result = publicRateLimiter.check(`public:${ip}`, PUBLIC_RPM);
  if (!result.allowed) {
    reply.header("Retry-After", String(result.retryAfterSeconds));
    reply.code(429).send({ error: "Too many requests", retryAfterSeconds: result.retryAfterSeconds });
    return false;
  }
  return true;
}

// --- Shared TTL cache for the expensive, visitor-agnostic aggregates ---
// /public/overview and /public/leaderboard aggregate usage_events WITHOUT a time
// filter, so Postgres seq-scans the whole table (~400ms / ~240ms at 510k rows) on
// every hit. The panel polls them every 45s per visitor, so N visitors used to mean
// N full scans. These payloads are identical for everyone, so one cached result is
// served to all callers within the TTL. Per-key endpoints (/public/me) are never
// cached — they're cheap (index scan) and must not leak across viewers.
type CacheEntry = { value: unknown; expires: number; inflight?: Promise<unknown> };
const aggregateCache = new Map<string, CacheEntry>();
const OVERVIEW_TTL_MS = 60_000;
const LEADERBOARD_TTL_MS = 45_000;

async function cachedAggregate<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = aggregateCache.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  // Collapse concurrent misses into a single DB round-trip (stampede guard):
  // without this, 10 simultaneous first-hits would still fire 10 seq scans.
  if (hit?.inflight) return hit.inflight as Promise<T>;

  const inflight = loader()
    .then((value) => {
      aggregateCache.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      aggregateCache.delete(key);
      throw err;
    });

  aggregateCache.set(key, { value: hit?.value, expires: 0, inflight });
  return inflight as Promise<T>;
}

export async function registerPublicRoutes(app: FastifyInstance) {
  // --- Viewer unlock: exchange a valid API key for a 7-day view cookie ---
  // Never returns key material and never distinguishes "wrong key" from
  // "revoked key" beyond the coarse reason codes below.
  app.post("/public/unlock", async (request, reply) => {
    const ip = clientIp(request as any);
    const limit = unlockRateLimiter.check(`unlock:${ip}`, UNLOCK_ATTEMPTS_PER_MIN);
    if (!limit.allowed) {
      reply.header("Retry-After", String(limit.retryAfterSeconds));
      return reply.code(429).send({
        error: "Too many attempts. Try again shortly.",
        code: "too_many_attempts",
        retryAfterSeconds: limit.retryAfterSeconds
      });
    }

    const raw = (request.body as any)?.api_key;
    const apiKey = typeof raw === "string" ? raw.trim() : "";
    if (!apiKey || apiKey.length < 8 || apiKey.length > 200) {
      return reply.code(400).send({ error: "API key required", code: "invalid_api_key" });
    }

    const record = await findApiKey(apiKey);
    if (!record || record.deleted_at) {
      return reply.code(401).send({ error: "Invalid API key", code: "invalid_api_key" });
    }
    // Expired / quota-exhausted keys may still view the panel (product decision):
    // buyers keep read access to their own stats after a package ends.

    let buyerName = "";
    if (record.buyer_id) {
      const b = await query<{ name: string }>(`select name from buyers where id = $1 limit 1`, [
        record.buyer_id
      ]);
      buyerName = b.rows[0]?.name ?? "";
    }

    const token = await new SignJWT({
      kh: viewerKeyFingerprint(apiKey),
      kid: record.id,
      name: buyerName
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${VIEWER_TTL_SECONDS}s`)
      .sign(viewerSecret);

    reply.setCookie(VIEWER_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.COOKIE_SECURE,
      path: "/",
      maxAge: VIEWER_TTL_SECONDS
    });

    return {
      unlocked: true,
      name: buyerName,
      session_expires_at: new Date(Date.now() + VIEWER_TTL_SECONDS * 1000).toISOString()
    };
  });

  // --- Viewer status (cheap, no DB hit) ---
  app.get("/public/unlock/status", async (request) => {
    const viewer = await readViewer(request);
    return {
      unlocked: !!viewer,
      name: viewer?.name ?? null,
      session_expires_at: viewer?.exp ? new Date(viewer.exp * 1000).toISOString() : null
    };
  });

  // --- Viewer lock (clear cookie) ---
  app.post("/public/lock", async (_request, reply) => {
    reply.clearCookie(VIEWER_COOKIE, { path: "/" });
    return { unlocked: false };
  });

  // --- Account info for the unlocking key (own data only) ---
  // Scoped strictly to the api_key id embedded in the viewer cookie, so one
  // buyer can never read another buyer's per-model usage.
  app.get("/public/me", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;
    const viewer = await readViewer(request);
    if (!viewer) {
      return reply.code(401).send({ error: "API key required to view this page", code: "unlock_required" });
    }
    // Legacy cookie without kid → force a re-unlock so we can bind it to a key id.
    if (!viewer.kid) {
      reply.clearCookie(VIEWER_COOKIE, { path: "/" });
      return reply.code(401).send({ error: "Please unlock again", code: "unlock_required" });
    }

    const keyRes = await query<any>(
      `SELECT k.id, k.label, k.key_prefix, k.created_at, k.expires_at, k.revoked_at,
              k.quota_tokens::text as quota_tokens, k.quota_requests::text as quota_requests,
              k.used_tokens::text as used_tokens, k.used_requests::text as used_requests,
              k.daily_reset, k.daily_quota_tokens::text as daily_quota_tokens,
              k.package_id, k.rate_limit_rpm, k.is_ultra, k.access_roles,
              b.name as buyer_name, b.email as buyer_email,
              CASE
                WHEN k.expires_at IS NULL THEN NULL
                ELSE GREATEST(0, EXTRACT(EPOCH FROM (k.expires_at - NOW())) / 86400)::int
              END as remaining_days
       FROM api_keys k
       LEFT JOIN buyers b ON b.id = k.buyer_id
       WHERE k.id = $1 AND k.deleted_at IS NULL
       LIMIT 1`,
      [viewer.kid]
    );
    const k = keyRes.rows[0];
    if (!k) {
      reply.clearCookie(VIEWER_COOKIE, { path: "/" });
      return reply.code(401).send({ error: "Key no longer available", code: "unlock_required" });
    }

    const [totals, perModel, today, recent] = await Promise.all([
      query<any>(
        `SELECT COUNT(*)::bigint as requests,
                COALESCE(SUM(total_tokens), 0)::bigint as tokens,
                COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
                COUNT(*) FILTER (WHERE success = true)::bigint as ok_requests,
                ROUND(AVG(latency_ms))::int as avg_latency_ms,
                MIN(created_at) as first_request_at,
                MAX(created_at) as last_request_at
         FROM usage_events
         WHERE api_key_id = $1 AND status_code != 400`,
        [viewer.kid]
      ),
      query<any>(
        `SELECT model_id,
                COUNT(*)::int as requests,
                COALESCE(SUM(total_tokens), 0)::bigint as tokens,
                COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
                ROUND(AVG(latency_ms))::int as avg_latency_ms,
                MAX(created_at) as last_request_at
         FROM usage_events
         WHERE api_key_id = $1 AND status_code != 400 AND model_id IS NOT NULL
         GROUP BY model_id
         ORDER BY tokens DESC`,
        [viewer.kid]
      ),
      query<any>(
        `SELECT COUNT(*)::bigint as requests,
                COALESCE(SUM(total_tokens), 0)::bigint as tokens
         FROM usage_events
         WHERE api_key_id = $1 AND status_code != 400
           AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`,
        [viewer.kid]
      ),
      query<any>(
        `SELECT created_at, model_id, status_code, success,
                prompt_tokens::text as prompt_tokens,
                completion_tokens::text as completion_tokens,
                total_tokens::text as total_tokens,
                latency_ms
         FROM usage_events
         WHERE api_key_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [viewer.kid]
      )
    ]);

    const t = totals.rows[0] ?? {};
    return {
      key: {
        label: k.label,
        key_prefix: k.key_prefix,
        buyer_name: k.buyer_name ?? "",
        buyer_email: maskEmail(k.buyer_email ?? ""),
        package_id: k.package_id,
        is_ultra: k.is_ultra,
        access_roles: k.access_roles ?? [],
        rate_limit_rpm: k.rate_limit_rpm,
        created_at: k.created_at,
        expires_at: k.expires_at,
        revoked_at: k.revoked_at,
        remaining_days: k.remaining_days,
        daily_reset: k.daily_reset,
        daily_quota_tokens: k.daily_quota_tokens === null ? null : Number(k.daily_quota_tokens),
        quota_tokens: k.quota_tokens === null ? null : Number(k.quota_tokens),
        quota_requests: k.quota_requests === null ? null : Number(k.quota_requests),
        used_tokens: Number(k.used_tokens ?? 0),
        used_requests: Number(k.used_requests ?? 0)
      },
      totals: {
        requests: Number(t.requests ?? 0),
        ok_requests: Number(t.ok_requests ?? 0),
        tokens: Number(t.tokens ?? 0),
        prompt_tokens: Number(t.prompt_tokens ?? 0),
        completion_tokens: Number(t.completion_tokens ?? 0),
        avg_latency_ms: t.avg_latency_ms === null ? null : Number(t.avg_latency_ms ?? 0),
        first_request_at: t.first_request_at ?? null,
        last_request_at: t.last_request_at ?? null,
        today_requests: Number(today.rows[0]?.requests ?? 0),
        today_tokens: Number(today.rows[0]?.tokens ?? 0)
      },
      models: perModel.rows.map((r: any) => ({
        model_id: r.model_id,
        requests: r.requests,
        tokens: Number(r.tokens),
        prompt_tokens: Number(r.prompt_tokens),
        completion_tokens: Number(r.completion_tokens),
        avg_latency_ms: r.avg_latency_ms === null ? null : Number(r.avg_latency_ms),
        last_request_at: r.last_request_at
      })),
      recent: recent.rows.map((r: any) => ({
        created_at: r.created_at,
        model_id: r.model_id,
        status_code: r.status_code,
        success: r.success,
        prompt_tokens: Number(r.prompt_tokens ?? 0),
        completion_tokens: Number(r.completion_tokens ?? 0),
        total_tokens: Number(r.total_tokens ?? 0),
        latency_ms: r.latency_ms
      })),
      session: {
        expires_at: viewer.exp ? new Date(viewer.exp * 1000).toISOString() : null,
        remaining_seconds: viewer.exp ? Math.max(0, Math.floor(viewer.exp - Date.now() / 1000)) : null
      }
    };
  });

  // --- Public Leaderboard (read-only, masked emails) ---
  // Optional ?q= filters by buyer name only. Full API-key lookup is intentionally disabled
  // (prevents public key-oracle checks). Never returns key material.
  // Super Admin is intentionally visible on the public panel (product request).
  app.get("/public/leaderboard", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;
    if (!(await requireViewer(request, reply))) return;

    const rawQ = String((request.query as any)?.q ?? "").trim();
    const q = rawQ.slice(0, 64);
    const params: unknown[] = [];
    let filterSql = `
      WHERE k.is_hidden = false
        AND k.deleted_at IS NULL
        AND k.revoked_at IS NULL
    `;

    if (q) {
      // Name-only search. Reject full-key shaped queries so this endpoint cannot
      // be used as an existence oracle for stolen API keys.
      if (/^9r-[A-Za-z0-9_-]{16,}$/i.test(q) || q.length >= 24) {
        return {
          q,
          rows: [],
          note: "Search by buyer name only"
        };
      }
      params.push("%" + q + "%");
      filterSql += `
        AND b.name ILIKE $1
      `;
    }

    const runLeaderboardQuery = async () => {
      const result = await query(
        `SELECT
        b.name as buyer_name,
        b.email as buyer_email,
        k.key_prefix,
        k.label as key_label,
        k.used_tokens::bigint as used_tokens,
        k.quota_tokens::bigint as quota_tokens,
        k.is_ultra,
        k.access_roles,
        COALESCE(stats.total_requests, 0)::int as total_requests,
        COALESCE(stats.total_tokens, 0)::bigint as total_tokens,
        stats.last_request_at,
        CASE
          WHEN k.expires_at IS NULL THEN NULL
          ELSE GREATEST(0, EXTRACT(EPOCH FROM (k.expires_at - NOW())) / 86400)::int
        END as remaining_days
      FROM api_keys k
      JOIN buyers b ON b.id = k.buyer_id
      LEFT JOIN (
        SELECT
          ue.api_key_id,
          COUNT(ue.id)::int as total_requests,
          COALESCE(SUM(ue.total_tokens), 0)::bigint as total_tokens,
          MAX(ue.created_at) as last_request_at
        FROM usage_events ue
        WHERE ue.status_code != 400
        GROUP BY ue.api_key_id
      ) stats ON stats.api_key_id = k.id
      ${filterSql}
      ORDER BY total_tokens DESC, total_requests DESC, b.name ASC`,
        params
      );
      return {
        q: q || null,
        rows: result.rows.map((r: any) => {
          const { key_prefix, key_label, ...rest } = r;
          return {
            ...rest,
            buyer_email: maskEmail(rest.buyer_email)
          };
        })
      };
    };

    // Only the unfiltered board is cached — that's the one the panel polls every 45s.
    // Search results are deliberately uncached so arbitrary ?q= values can't grow the
    // cache map unbounded (and searches are rare + user-initiated).
    if (q) return await runLeaderboardQuery();
    return await cachedAggregate("leaderboard", LEADERBOARD_TTL_MS, runLeaderboardQuery);
  });

  // --- Public Live (read-only) ---
  app.get("/public/live", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;
    if (!(await requireViewer(request, reply))) return;

    const result = await query(
      `SELECT 
        k.key_prefix,
        b.name as buyer_name,
        k.quota_tokens,
        k.is_ultra,
        k.access_roles,
        count(ue.id)::int as request_count,
        max(ue.created_at) as last_request_at,
        sum(ue.total_tokens)::bigint as total_tokens,
        count(distinct ue.ip_address)::int as ip_count,
        array_agg(distinct ue.model_id) filter (where ue.model_id is not null) as models_used
       FROM usage_events ue
       JOIN api_keys k ON k.id = ue.api_key_id
       JOIN buyers b ON b.id = k.buyer_id
       WHERE ue.created_at > now() - interval '5 minutes'
         AND k.is_hidden = false AND ue.status_code != 400
       GROUP BY k.id, k.key_prefix, b.name, k.quota_tokens, k.is_ultra, k.access_roles
       ORDER BY max(ue.created_at) DESC`
    );
    const active = result.rows.map((r: any) => ({
      buyer_name: r.buyer_name,
      quota_tokens: r.quota_tokens,
      is_ultra: r.is_ultra,
      access_roles: r.access_roles,
      request_count: r.request_count,
      last_request_at: r.last_request_at,
      total_tokens: r.total_tokens,
      ip_count: Number(r.ip_count) || 0,
      models_used: r.models_used
    }));
    // Totals for last-5m window — same filters as the per-key rows above.
    const active_keys = active.length;
    const requests = active.reduce(
      (sum: number, row: any) => sum + Number(row.request_count || 0),
      0
    );
    const tokens = active.reduce(
      (sum: number, row: any) => sum + Number(row.total_tokens || 0),
      0
    );
    return {
      summary: {
        active_keys,
        requests,
        tokens,
        window_minutes: 5
      },
      active
    };
  });

  // --- Public Usage (read-only, limited, no key material) ---
  app.get("/public/usage", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

    const result = await query(
      `SELECT ue.created_at, ue.endpoint, ue.model_id, ue.status_code, ue.success,
        ue.prompt_tokens, ue.completion_tokens, ue.total_tokens, ue.latency_ms,
        k.key_prefix, b.name as buyer_name, k.quota_tokens, k.is_ultra, k.access_roles
       FROM usage_events ue
       JOIN api_keys k ON k.id = ue.api_key_id
       JOIN buyers b ON b.id = k.buyer_id
       WHERE k.is_hidden = false
         AND ue.success = true
         AND ue.status_code = 200
       ORDER BY ue.created_at DESC
       LIMIT 200`
    );
    return {
      events: result.rows.map((r: any) => {
        const { key_prefix, ...rest } = r;
        return rest;
      })
    };
  });

  // --- Public Usage Chart ---
  app.get("/public/usage/chart", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

    const range = (request.query as any)?.range || "7d";

    const config: Record<string, { interval: string; trunc: string; format: string }> = {
      "15m": { interval: "15 minutes", trunc: "minute", format: "HH24:MI" },
      "1h": { interval: "1 hour", trunc: "minute", format: "HH24:MI" },
      "6h": { interval: "6 hours", trunc: "hour", format: "HH24:MI" },
      "12h": { interval: "12 hours", trunc: "hour", format: "HH24:MI" },
      "1d": { interval: "1 day", trunc: "hour", format: "HH24:MI" },
      "3d": { interval: "3 days", trunc: "day", format: "DD Mon" },
      "7d": { interval: "7 days", trunc: "day", format: "DD Mon" },
      "1M": { interval: "30 days", trunc: "day", format: "DD Mon" }
    };

    const cfg = config[range] || config["7d"];

    const truncExpr =
      cfg.trunc === "minute" && range === "1h"
        ? "date_trunc('hour', created_at AT TIME ZONE 'Asia/Jakarta') + (floor(date_part('minute', created_at AT TIME ZONE 'Asia/Jakarta') / 15) * interval '15 min')"
        : `date_trunc('${cfg.trunc}', created_at AT TIME ZONE 'Asia/Jakarta')`;

    const queryStr = `
      SELECT 
        to_char(${truncExpr}, '${cfg.format}') AS label,
        COUNT(*)::integer AS requests,
        COALESCE(SUM(total_tokens), 0)::bigint AS tokens
      FROM usage_events
      WHERE created_at >= NOW() - INTERVAL '${cfg.interval}'
        AND status_code != 400
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr} ASC
    `;

    const result = await query(queryStr);
    return { points: result.rows };
  });

  // --- Public 24h Stats (total + per-model breakdown) ---
  app.get("/public/stats24h", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

    const [totals, perModel, topUsers] = await Promise.all([
      query(
        `SELECT COUNT(*)::bigint as requests,
                COALESCE(SUM(total_tokens), 0)::bigint as tokens
         FROM usage_events
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND status_code != 400`
      ),
      query(
        `SELECT model_id,
                COUNT(*)::int as requests,
                COALESCE(SUM(total_tokens), 0)::bigint as tokens,
                COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
                MAX(created_at) as last_request_at
         FROM usage_events
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND status_code != 400
           AND model_id IS NOT NULL
         GROUP BY model_id
         ORDER BY tokens DESC`
      ),
      query(
        `SELECT model_id, buyer_name, requests, tokens
         FROM (
           SELECT ue.model_id,
                  b.name as buyer_name,
                  COUNT(*)::int as requests,
                  COALESCE(SUM(ue.total_tokens), 0)::bigint as tokens,
                  ROW_NUMBER() OVER (
                    PARTITION BY ue.model_id
                    ORDER BY COALESCE(SUM(ue.total_tokens), 0) DESC, COUNT(*) DESC
                  ) as rn
           FROM usage_events ue
           JOIN api_keys k ON k.id = ue.api_key_id
           JOIN buyers b ON b.id = k.buyer_id
           WHERE ue.created_at >= NOW() - INTERVAL '24 hours'
             AND ue.status_code != 400
             AND k.is_hidden = false
             AND k.deleted_at IS NULL
             AND ue.model_id IS NOT NULL
           GROUP BY ue.model_id, b.id, b.name
         ) ranked
         WHERE rn <= 3`
      )
    ]);

    const usersByModel = new Map<string, { buyer_name: string; requests: number; tokens: number }[]>();
    for (const r of topUsers.rows as any[]) {
      const id = String(r.model_id || '');
      if (!id) continue;
      const list = usersByModel.get(id) || [];
      list.push({
        buyer_name: r.buyer_name,
        requests: r.requests,
        tokens: Number(r.tokens)
      });
      usersByModel.set(id, list);
    }

    return {
      totals: {
        requests: Number(totals.rows[0].requests),
        tokens: Number(totals.rows[0].tokens)
      },
      models: perModel.rows.map((r: any) => ({
        model_id: r.model_id,
        requests: r.requests,
        tokens: Number(r.tokens),
        prompt_tokens: Number(r.prompt_tokens),
        completion_tokens: Number(r.completion_tokens),
        last_request_at: r.last_request_at,
        top_users: usersByModel.get(r.model_id) || []
      }))
    };
  });

  // --- Public Overview Stats ---
  app.get("/public/overview", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

    // Two of these four queries seq-scan usage_events (no time filter), so the whole
    // payload is cached — it is identical for every visitor.
    return await cachedAggregate("overview", OVERVIEW_TTL_MS, async () => {
      // Exclude hidden keys only (Super Admin stays counted / visible publicly).
      const [buyerCount, keyCount, reqCount, tokenCount] = await Promise.all([
        query(`SELECT COUNT(*)::int as count FROM buyers`),
        query(
          `SELECT COUNT(*)::int as count FROM api_keys k
         WHERE k.deleted_at IS NULL AND k.revoked_at IS NULL
           AND k.is_hidden = false`
        ),
        query(`SELECT COUNT(*)::bigint as count FROM usage_events WHERE status_code != 400`),
        query(
          `SELECT COALESCE(SUM(total_tokens), 0)::bigint as sum FROM usage_events WHERE status_code != 400`
        )
      ]);
      return {
        buyers: buyerCount.rows[0].count,
        activeKeys: keyCount.rows[0].count,
        requests: Number(reqCount.rows[0].count),
        tokens: Number(tokenCount.rows[0].sum)
      };
    });
  });
}
