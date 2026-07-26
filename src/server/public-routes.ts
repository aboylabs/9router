import type { FastifyInstance } from "fastify";
import { query } from "./db.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";

// Public endpoints are scrapeable; light per-IP throttle (not for buyer chat).
const publicRateLimiter = new FixedWindowRateLimiter(60_000);
const PUBLIC_RPM = 120;

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

export async function registerPublicRoutes(app: FastifyInstance) {
  // --- Public Leaderboard (read-only, masked emails) ---
  // Optional ?q= filters by buyer name only. Full API-key lookup is intentionally disabled
  // (prevents public key-oracle checks). Never returns key material.
  // Super Admin is intentionally visible on the public panel (product request).
  app.get("/public/leaderboard", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

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

    const limit = q ? 50 : 100;
    const result = await query(
      `SELECT
        b.name as buyer_name,
        b.email as buyer_email,
        k.key_prefix,
        k.label as key_label,
        k.used_tokens::bigint as used_tokens,
        k.quota_tokens::bigint as quota_tokens,
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
      ORDER BY k.used_tokens DESC, total_requests DESC, b.name ASC
      LIMIT ${limit}`,
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
  });

  // --- Public Live (read-only) ---
  app.get("/public/live", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

    const result = await query(
      `SELECT 
        k.key_prefix,
        b.name as buyer_name,
        k.quota_tokens,
        count(ue.id)::int as request_count,
        max(ue.created_at) as last_request_at,
        sum(ue.total_tokens)::bigint as total_tokens,
        array_agg(distinct ue.model_id) filter (where ue.model_id is not null) as models_used
       FROM usage_events ue
       JOIN api_keys k ON k.id = ue.api_key_id
       JOIN buyers b ON b.id = k.buyer_id
       WHERE ue.created_at > now() - interval '5 minutes'
         AND k.is_hidden = false AND ue.status_code != 400
       GROUP BY k.id, k.key_prefix, b.name, k.quota_tokens
       ORDER BY max(ue.created_at) DESC`
    );
    const active = result.rows.map((r: any) => {
      const { key_prefix, ...rest } = r;
      return rest;
    });
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
        k.key_prefix, b.name as buyer_name, k.quota_tokens
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

  // --- Public Overview Stats ---
  app.get("/public/overview", async (request, reply) => {
    if (!enforcePublicRateLimit(request, reply)) return;

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
}
