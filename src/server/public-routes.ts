import type { FastifyInstance } from "fastify";
import { query } from "./db.js";

function maskEmail(email: string): string {
  if (!email) return "hidden";
  const [local, domain] = email.split("@");
  if (!domain) return local.substring(0, 2) + "***";
  return local.substring(0, 1) + "***@" + domain;
}

export async function registerPublicRoutes(app: FastifyInstance) {
  // --- Public Leaderboard (read-only, masked emails) ---
  app.get("/public/leaderboard", async () => {
    const result = await query(
      `SELECT 
        b.name as buyer_name,
        b.email as buyer_email,
        k.key_prefix,
        k.label as key_label,
        COUNT(ue.id)::int as total_requests,
        COALESCE(SUM(ue.total_tokens), 0)::bigint as total_tokens,
        MAX(ue.created_at) as last_request_at,
        CASE 
          WHEN k.expires_at IS NULL THEN NULL
          ELSE GREATEST(0, EXTRACT(EPOCH FROM (k.expires_at - NOW())) / 86400)::int
        END as remaining_days
      FROM usage_events ue
      JOIN api_keys k ON k.id = ue.api_key_id
      JOIN buyers b ON b.id = k.buyer_id
      WHERE k.is_hidden = false AND ue.status_code != 400
      GROUP BY b.id, b.name, b.email, k.id, k.label, k.key_prefix, k.expires_at
      HAVING COUNT(ue.id) > 0
      ORDER BY total_requests DESC
      LIMIT 100`
    );
    return {
      rows: result.rows.map((r: any) => {
        const { key_prefix, key_label, ...rest } = r;
        return {
          ...rest,
          buyer_email: maskEmail(rest.buyer_email),
        };
      }),
    };
  });

  // --- Public Live (read-only, masked emails) ---
  app.get("/public/live", async () => {
    const result = await query(
      `SELECT 
        k.key_prefix,
        b.name as buyer_name,
        count(ue.id)::int as request_count,
        max(ue.created_at) as last_request_at,
        sum(ue.total_tokens)::bigint as total_tokens,
        array_agg(distinct ue.model_id) filter (where ue.model_id is not null) as models_used
       FROM usage_events ue
       JOIN api_keys k ON k.id = ue.api_key_id
       JOIN buyers b ON b.id = k.buyer_id
       WHERE ue.created_at > now() - interval '5 minutes'
         AND k.is_hidden = false AND ue.status_code != 400
       GROUP BY k.id, k.key_prefix, b.name
       ORDER BY max(ue.created_at) DESC`
    );
    return {
      active: result.rows.map((r: any) => {
        const { key_prefix, ...rest } = r;
        return rest;
      }),
    };
  });

  // --- Public Usage (read-only, limited, no buyer details) ---
  app.get("/public/usage", async () => {
    const result = await query(
      `SELECT ue.created_at, ue.endpoint, ue.model_id, ue.status_code, ue.success,
        ue.prompt_tokens, ue.completion_tokens, ue.total_tokens, ue.latency_ms,
        k.key_prefix, b.name as buyer_name
       FROM usage_events ue
       JOIN api_keys k ON k.id = ue.api_key_id
       JOIN buyers b ON b.id = k.buyer_id
       WHERE k.is_hidden = false AND ue.status_code != 400
       ORDER BY ue.created_at DESC
       LIMIT 200`
    );
    return {
      events: result.rows.map((r: any) => {
        const { key_prefix, ...rest } = r;
        return rest;
      }),
    };
  });

  // --- Public Usage Chart ---
  app.get("/public/usage/chart", async (request) => {
    const range = (request.query as any)?.range || "7d";

    const config: Record<string, { interval: string; trunc: string; format: string }> = {
      "15m": { interval: "15 minutes", trunc: "minute", format: "HH24:MI" },
      "1h": { interval: "1 hour", trunc: "minute", format: "HH24:MI" },
      "6h": { interval: "6 hours", trunc: "hour", format: "HH24:MI" },
      "12h": { interval: "12 hours", trunc: "hour", format: "HH24:MI" },
      "1d": { interval: "1 day", trunc: "hour", format: "HH24:MI" },
      "3d": { interval: "3 days", trunc: "day", format: "DD Mon" },
      "7d": { interval: "7 days", trunc: "day", format: "DD Mon" },
      "1M": { interval: "30 days", trunc: "day", format: "DD Mon" },
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
  app.get("/public/overview", async () => {
    const [buyerCount, keyCount, reqCount, tokenCount] = await Promise.all([
      query(`SELECT COUNT(*)::int as count FROM buyers`),
      query(`SELECT COUNT(*)::int as count FROM api_keys WHERE deleted_at IS NULL AND revoked_at IS NULL`),
      query(`SELECT COUNT(*)::bigint as count FROM usage_events WHERE status_code != 400`),
      query(`SELECT COALESCE(SUM(total_tokens), 0)::bigint as sum FROM usage_events WHERE status_code != 400`),
    ]);
    return {
      buyers: buyerCount.rows[0].count,
      activeKeys: keyCount.rows[0].count,
      requests: Number(reqCount.rows[0].count),
      tokens: Number(tokenCount.rows[0].sum),
    };
  });
}
