import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { query, pool } from "./db.js";
import {
  aliasForUpstreamModel,
  displayNameForModel,
  isAllowedPublicModelId,
  isAllowedUpstreamModelId
} from "./model-alias.js";
import { createSession, clearSession, readSession, requireAdmin, getActiveSessions, revokeSession, revokeAllOtherSessions } from "./session.js";
import { createApiKeyRecord, createBuyerWithApiKeyRecord, invalidateApiKeyCache } from "./repositories.js";
import { generateApiKey, apiKeyPrefix, hashApiKey, hashPassword, verifyPassword } from "./security.js";
import { FixedWindowRateLimiter, chatRateLimiter } from "./rate-limiter.js";

// Login rate limiter: max 5 attempts per IP per 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;
const loginRateLimiter = {
  windows: new Map<string, { count: number; resetAt: number }>(),
  check(ip: string, limit: number) {
    const now = Date.now();
    const existing = this.windows.get(ip);
    const resetAt = now + 15 * 60 * 1000;
    
    if (!existing || existing.resetAt <= now) {
      this.windows.set(ip, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }
    
    if (existing.count >= limit) {
      return { 
        allowed: false, 
        remaining: 0, 
        resetAt: existing.resetAt, 
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      };
    }
    
    existing.count += 1;
    return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
  }
};
import { clearUpstreamCache, fetchUpstreamModels, getUpstreams } from "./upstream.js";
import {
  CREATABLE_PACKAGE_IDS,
  DEFAULT_PACKAGE_ID,
  PRESET_PACKAGES_BY_ID,
  salesBucketForPackageId,
  salesPriceForPackageId
} from "../shared/package-catalog.js";

/** Get current time in Indonesia (WIB/GMT+7) as ISO string */
function nowMYT(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}

/** Get expires_at: N hours from now, returned as ISO string */
function expiresInHours(hours: number): string {
  const now = Date.now();
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1)
});

const buyerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable()
});

const modelSchema = z.object({
  id: z.string().min(1),
  upstream_model: z.string().min(1),
  display_name: z.string().min(1),
  active: z.boolean().default(true),
  input_cost_per_million: z.number().optional().nullable(),
  output_cost_per_million: z.number().optional().nullable()
});

const keySchema = z.object({
  label: z.string().min(1),
  expires_at: z.string().datetime().optional().nullable(),
  quota_tokens: z.number().int().positive().optional().nullable(),
  quota_requests: z.number().int().positive().optional().nullable(),
  model_ids: z.array(z.string()).min(1)
});

const ALWAYS_AVAILABLE_MODELS = [
  { id: "9router/combo-qwen3.7-plus", upstream_model: "combo-qwen3.7-plus", display_name: "Combo Qwen3.7 Plus" },
  { id: "9router/combo-qwen3.7-max", upstream_model: "combo-qwen3.7-max", display_name: "Combo Qwen3.7 Max" },
  { id: "9router/combo-qwen3.6-max", upstream_model: "combo-qwen3.6-max", display_name: "Combo Qwen3.6 Max" },
  { id: "9router/combo-qwen-deepseek", upstream_model: "combo-qwen-deepseek", display_name: "Combo Qwen Deepseek" },
  { id: "9router/minimax/MiniMax-M2.7", upstream_model: "minimax/MiniMax-M2.7", display_name: "MiniMax M2.7" },
  { id: "9router/minimax/MiniMax-M2.5", upstream_model: "minimax/MiniMax-M2.5", display_name: "MiniMax M2.5" },

  { id: "9router/minimax/MiniMax-M2.7-highspeed", upstream_model: "minimax/MiniMax-M2.7-highspeed", display_name: "MiniMax M2.7 Highspeed" },
  { id: "9router/MiniMax/MiniMax-M3", upstream_model: "MiniMax/MiniMax-M3", display_name: "MiniMax M3" },
  { id: "9router/MiniMax/MiniMax-M2.7", upstream_model: "MiniMax/MiniMax-M2.7", display_name: "MiniMax M2.7" },
  { id: "9router/MiniMax/MiniMax-M2.7-highspeed", upstream_model: "MiniMax/MiniMax-M2.7-highspeed", display_name: "MiniMax M2.7 Highspeed" },
  { id: "9router/alibaba/qwen3.7-plus-2026-05-26", upstream_model: "alibaba/qwen3.7-plus-2026-05-26", display_name: "Qwen3.7 Plus (2026-05-26)" },
  { id: "9router/alibaba/qwen3.7-plus", upstream_model: "alibaba/qwen3.7-plus", display_name: "Qwen3.7 Plus" },
  { id: "9router/alibaba/glm-5.1", upstream_model: "alibaba/glm-5.1", display_name: "GLM 5.1" },
  { id: "9router/alibaba/qwen3.7-max-2026-05-17", upstream_model: "alibaba/qwen3.7-max-2026-05-17", display_name: "Qwen3.7 Max (2026-05-17)" },
  { id: "9router/alibaba/qwen3.7-max-preview", upstream_model: "alibaba/qwen3.7-max-preview", display_name: "Qwen3.7 Max Preview" },
  { id: "9router/alibaba/qwen3.7-max-2026-05-20", upstream_model: "alibaba/qwen3.7-max-2026-05-20", display_name: "Qwen3.7 Max (2026-05-20)" },
  { id: "9router/alibaba/qwen3.7-max", upstream_model: "alibaba/qwen3.7-max", display_name: "Qwen3.7 Max" },
  { id: "9router/alibaba/deepseek-v4-flash", upstream_model: "alibaba/deepseek-v4-flash", display_name: "DeepSeek V4 Flash" },
  { id: "9router/alibaba/deepseek-v4-pro", upstream_model: "alibaba/deepseek-v4-pro", display_name: "DeepSeek V4 Pro" },
  { id: "9router/alibaba/qwen3.6-max-preview", upstream_model: "alibaba/qwen3.6-max-preview", display_name: "Qwen3.6 Max Preview" },
  { id: "9router/alibaba/qwen3.6-plus-2026-04-02", upstream_model: "alibaba/qwen3.6-plus-2026-04-02", display_name: "Qwen3.6 Plus (2026-04-02)" },
  { id: "9router/alibaba/qwen3.6-plus", upstream_model: "alibaba/qwen3.6-plus", display_name: "Qwen3.6 Plus" },
  { id: "9router/alibaba/qwen3.6-35b-a3b", upstream_model: "alibaba/qwen3.6-35b-a3b", display_name: "Qwen3.6 35B-A3B" },
  { id: "9router/alibaba/qwen3.6-27b", upstream_model: "alibaba/qwen3.6-27b", display_name: "Qwen3.6 27B" },
  { id: "9router/alibaba/qwen3.6-flash", upstream_model: "alibaba/qwen3.6-flash", display_name: "Qwen3.6 Flash" },
  { id: "9router/alibaba/qwen3.6-flash-2026-04-16", upstream_model: "alibaba/qwen3.6-flash-2026-04-16", display_name: "Qwen3.6 Flash (2026-04-16)" },
] as const;

const buyerPackageSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
  package_id: z.enum(CREATABLE_PACKAGE_IDS).default(DEFAULT_PACKAGE_ID),
});

const createKeySchema = z.object({
  name: z.string().min(1),
  days: z.number().int().positive(),
  rateLimitRpm: z.number().int().positive().optional().nullable(),
});

const upstreamModelSchema = z.object({
  id: z.string().min(1)
}).passthrough();

const upstreamModelsResponseSchema = z.object({
  data: z.array(upstreamModelSchema)
}).passthrough();

function generateBuyerPassword(): string {
  return crypto.randomBytes(8).toString("base64url").slice(0, 12);
}

async function activeAllowedModelIds() {
  const result = await query<{ id: string }>(
    `select id
     from models
     where active = true
       and id like '9router/%'
     order by display_name asc`
  );
  return result.rows.map((row) => row.id);
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/admin/auth/login", async (request, reply) => {
    // Rate limit: max 5 attempts per IP per 15 minutes
    const rateResult = loginRateLimiter.check(request.ip, MAX_LOGIN_ATTEMPTS);
    if (!rateResult.allowed) {
      return reply.code(429).send({ 
        error: "Too many login attempts", 
        retryAfterSeconds: rateResult.retryAfterSeconds 
      });
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid login payload" });

    const result = await query<{ id: string; email: string; password_hash: string }>(
      `select id, email, password_hash from admins where email = $1 limit 1`,
      [parsed.data.email.toLowerCase()]
    );
    const admin = result.rows[0];
    if (!admin || !(await verifyPassword(parsed.data.password, admin.password_hash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    await createSession(reply, { adminId: admin.id, email: admin.email }, request.ip, request.headers["user-agent"]);
    return { admin: { id: admin.id, email: admin.email } };
  });

  app.post("/admin/auth/logout", async (_request, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get("/admin/me", async (request) => {
    const session = await readSession(request);
    return { admin: session };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin/")) return;
    if (request.url.startsWith("/admin/assets/")) return;
    if (request.url.startsWith("/admin/auth/") || request.url === "/admin/me" || request.url === "/admin/") return;
    await requireAdmin(request, reply);
  });

  // --- Buyer lookup by email (for Create Key flow) ---
  app.get("/admin/buyers/by-email", async (request, reply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid email" });

    const result = await query<{ id: string; name: string; email: string }>(
      `select id, name, email from buyers where email = $1 order by created_at desc limit 1`,
      [parsed.data.email.toLowerCase()]
    );

    if (!result.rowCount) return { exists: false, buyer: null };
    return { exists: true, buyer: result.rows[0] };
  });

  // --- Create API Key ---
  app.post("/admin/create-key", async (request, reply) => {
    const parsed = createKeySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload. Requires name (string) and days (number)" });

    const keyTag = crypto.randomBytes(4).toString("hex");
    const email = `key-${keyTag}@9router.local`;
    const buyerPassword = generateBuyerPassword();
    const hash = await hashPassword(buyerPassword);
    const buyerResult = await query<{ id: string }>(
      `insert into buyers (name, email, password_hash) values ($1, $2, $3) returning id`,
      [parsed.data.name, email, hash]
    );
    const buyerId = buyerResult.rows[0].id;

    const apiKey = generateApiKey();
    const expiresAt = new Date(Date.now() + parsed.data.days * 24 * 60 * 60 * 1000).toISOString();
    const label = `${parsed.data.days} hari`;

    const modelIds = await activeAllowedModelIds();
    if (!modelIds.length) {
      return reply.code(500).send({ error: "No active white-label models are configured" });
    }

    const keyRecord = await createApiKeyRecord({
      buyerId,
      label,
      apiKey,
      expiresAt,
      quotaTokens: null,
      quotaRequests: null,
      modelIds,
      dailyReset: false,
      dailyQuotaTokens: null,
      packageId: null,
      rateLimitRpm: parsed.data.rateLimitRpm ?? null
    });
    invalidateApiKeyCache();

    const createdAt = new Date().toISOString();

    return reply.code(201).send({
      apiKey,
      name: parsed.data.name,
      email,
      password: buyerPassword,
      isExistingBuyer: false,
      buyerId,
      keyId: keyRecord.id,
      keyPrefix: keyRecord.key_prefix,
      created_at: createdAt,
      days: parsed.data.days,
      package: {
        id: null,
        label,
        quota_tokens: null,
        daily_quota_tokens: null,
        daily_reset: false,
        expires_at: expiresAt
      }
    });
  });

  // --- Reset buyer password ---
  app.post("/admin/buyers/:buyerId/reset-password", async (request, reply) => {
    const params = z.object({ buyerId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid buyer id" });

    const newPassword = generateBuyerPassword();
    const hash = await hashPassword(newPassword);
    const result = await query(
      `update buyers set password_hash = $1 where id = $2 returning id, email`,
      [hash, params.data.buyerId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Buyer not found" });

    return { password: newPassword, buyer: result.rows[0] };
  });

  // --- Update buyer name ---
  app.patch("/admin/buyers/:buyerId", async (request, reply) => {
    const params = z.object({ buyerId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid buyer id" });

    const body = z.object({ name: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { name: string }" });

    const result = await query<{ id: string; name: string }>(
      `UPDATE buyers SET name = $1 WHERE id = $2 RETURNING id, name`,
      [body.data.name, params.data.buyerId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Buyer not found" });

    invalidateApiKeyCache();
    return { buyer: result.rows[0] };
  });

  // --- Extend key expiry ---
  app.post("/admin/keys/:keyId/extend", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const body = z.object({ expires_at: z.string().refine((v) => !isNaN(Date.parse(v))) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { expires_at: string }" });

    const result = await query<{ id: string; expires_at: string }>(
      `UPDATE api_keys SET expires_at = $1::timestamp WHERE id = $2 AND deleted_at IS NULL RETURNING id, expires_at`,
      [body.data.expires_at, params.data.keyId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Key not found" });

    return { key: result.rows[0], expires_at: body.data.expires_at };
  });

  app.post("/admin/keys/extend", async (request, reply) => {
    const body = z.object({
      all: z.boolean().optional(),
      keyIds: z.array(z.string().uuid()).optional(),
      expires_at: z.string().refine((v) => !isNaN(Date.parse(v)))
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { expires_at, all?: true, keyIds?: string[] }" });

    const { all, keyIds, expires_at } = body.data;
    if (!all && (!keyIds || keyIds.length === 0)) {
      return reply.code(400).send({ error: "Must provide 'all: true' or 'keyIds' array" });
    }

    let result;
    const activeFilter = `deleted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() AND is_hidden = false`;

    if (all) {
      result = await query(
        `UPDATE api_keys SET expires_at = $1::timestamp WHERE ${activeFilter}`,
        [expires_at]
      );
    } else {
      result = await query(
        `UPDATE api_keys SET expires_at = $1::timestamp WHERE id = ANY($2) AND ${activeFilter}`,
        [expires_at, keyIds]
      );
    }

    return { updated: result.rowCount || 0, expires_at };
  });

  // --- Add tokens to keys ---
  app.post("/admin/keys/add-tokens", async (request, reply) => {
    const body = z.object({
      all: z.boolean().optional(),
      keyIds: z.array(z.string().uuid()).optional(),
      tokens: z.number().int().positive()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { tokens, all?: true, keyIds?: string[] }" });

    const { all, keyIds, tokens } = body.data;
    if (!all && (!keyIds || keyIds.length === 0)) {
      return reply.code(400).send({ error: "Must provide 'all: true' or 'keyIds' array" });
    }

    let result;
    const baseFilter = `deleted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() AND is_hidden = false AND (daily_reset = false OR daily_reset IS NULL)`;

    if (all) {
      result = await query(
        `UPDATE api_keys SET quota_tokens = COALESCE(quota_tokens, 0) + $1 WHERE ${baseFilter}`,
        [tokens]
      );
    } else {
      result = await query(
        `UPDATE api_keys SET quota_tokens = COALESCE(quota_tokens, 0) + $1 WHERE id = ANY($2) AND ${baseFilter}`,
        [tokens, keyIds]
      );
    }

    return { updated: result.rowCount || 0, tokens_added: tokens };
  });

  app.get("/admin/overview", async () => {
    const [buyers, keys, usage] = await Promise.all([
      query<{ count: string }>(`select count(*) from buyers`),
      query<{ count: string }>(`select count(*) from api_keys where deleted_at is null and revoked_at is null and is_hidden = false`),
      query<{ requests: string; tokens: string; cost: string }>(
        `select count(*) as requests, coalesce(sum(total_tokens), 0) as tokens, coalesce(sum(cost_estimate), 0) as cost
         from usage_events WHERE status_code != 400`
      )
    ]);

    return {
      buyers: Number(buyers.rows[0].count),
      activeKeys: Number(keys.rows[0].count),
      requests: Number(usage.rows[0].requests),
      tokens: Number(usage.rows[0].tokens),
      costEstimate: Number(usage.rows[0].cost)
    };
  });

  app.get("/admin/buyers", async () => {
    const result = await query(
      `select b.id, b.name, b.email, b.notes, b.created_at,
        coalesce(sum(k.used_tokens) filter (where k.deleted_at is null and k.is_hidden = false), 0)::bigint as used_tokens,
        coalesce(sum(k.quota_tokens) filter (where k.deleted_at is null and k.is_hidden = false), 0)::bigint as total_quota,
        coalesce(sum(k.used_requests) filter (where k.deleted_at is null and k.is_hidden = false), 0)::bigint as request_count,
        count(k.id) filter (where k.deleted_at is null and k.is_hidden = false)::integer as key_count,
        array_remove(array_agg(k.key_prefix || '****') filter (where k.deleted_at is null and k.is_hidden = false), null) as api_keys
       from buyers b
       left join api_keys k on k.buyer_id = b.id
       group by b.id
       order by b.created_at desc`
    );
    return { buyers: result.rows };
  });

  app.post("/admin/buyers", async (request, reply) => {
    const parsed = buyerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid buyer payload" });

    const result = await query(
      `insert into buyers (name, email, notes) values ($1, $2, $3) returning *`,
      [parsed.data.name, parsed.data.email ?? null, parsed.data.notes ?? null]
    );
    return reply.code(201).send({ buyer: result.rows[0] });
  });

  app.post("/admin/buyer-packages", async (request, reply) => {
    const parsed = buyerPackageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid buyer package payload" });

    const pkg = PRESET_PACKAGES_BY_ID[parsed.data.package_id];
    const pkgId = pkg.id;
    const pkgLabel = pkg.label;
    const pkgQuota = pkg.quotaTokens;
    const pkgExpiryHours = pkg.expiryHours;
    const pkgDailyReset = pkg.dailyReset;
    const pkgDailyQuota = pkg.dailyQuotaTokens;

    const apiKey = generateApiKey();
    const expiresAt = expiresInHours(pkgExpiryHours);
    const modelIds = await activeAllowedModelIds();
    if (!modelIds.length) {
      return reply.code(500).send({ error: "No active white-label models are configured" });
    }

    const created = await createBuyerWithApiKeyRecord({
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      notes: parsed.data.notes ?? null,
      keyLabel: pkgLabel,
      apiKey,
      expiresAt,
      quotaTokens: pkgQuota,
      quotaRequests: null,
      modelIds,
      dailyReset: pkgDailyReset,
      dailyQuotaTokens: pkgDailyQuota,
      packageId: pkgId
    });
    invalidateApiKeyCache();

    return reply.code(201).send({
      apiKey,
      package: {
        id: pkgId,
        label: pkgLabel,
        quota_tokens: pkgQuota,
        daily_quota_tokens: pkgDailyQuota,
        daily_reset: pkgDailyReset,
        expires_at: expiresAt
      },
      ...created,
      warning: "This API key is shown once. Store it now."
    });
  });

  app.get("/admin/models", async () => {
    const result = await query(`select * from models where id not like 'kr/%' order by display_name asc`);
    return { models: result.rows };
  });

  app.post("/admin/models", async (request, reply) => {
    const parsed = modelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid model payload" });

    const model = parsed.data;
    const result = await query(
      `insert into models
       (id, upstream_model, display_name, active, input_cost_per_million, output_cost_per_million)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
        upstream_model = excluded.upstream_model,
        display_name = excluded.display_name,
        active = excluded.active,
        input_cost_per_million = excluded.input_cost_per_million,
        output_cost_per_million = excluded.output_cost_per_million
       returning *`,
      [
        model.id,
        model.upstream_model,
        model.display_name,
        model.active,
        model.input_cost_per_million ?? null,
        model.output_cost_per_million ?? null
      ]
    );
    return { model: result.rows[0] };
  });

  app.post("/admin/models/sync", async (_request, reply) => {
    const upstream = await fetchUpstreamModels();
    if (upstream.statusCode < 200 || upstream.statusCode >= 400) {
      return reply.code(502).send({
        error: "Unable to fetch models from upstream",
        statusCode: upstream.statusCode,
        upstream: upstream.body
      });
    }

    const parsed = upstreamModelsResponseSchema.safeParse(upstream.body);
    if (!parsed.success) {
      return reply.code(502).send({ error: "Upstream returned an unsupported models payload" });
    }

    const synced = [];
    let granted = 0;
    const syncedIds = new Set<string>();
    
    for (const model of parsed.data.data) {
      if (!isAllowedUpstreamModelId(model.id)) continue;
      const aliasId = aliasForUpstreamModel(model.id);
      if (!isAllowedPublicModelId(aliasId)) continue;
      const displayName = displayNameForModel(aliasId);
      const result = await query(
        `insert into models (id, upstream_model, display_name, active)
         values ($1, $2, $3, true)
         on conflict (id) do update set
          upstream_model = excluded.upstream_model,
          display_name = excluded.display_name,
          active = true
         returning *`,
        [aliasId, model.id, displayName]
      );
      synced.push(result.rows[0]);
      syncedIds.add(aliasId);

      const grantResult = await query(
        `insert into buyer_model_access (api_key_id, model_id)
         select id, $1 from api_keys
         on conflict do nothing`,
        [aliasId]
      );
      granted += grantResult.rowCount ?? 0;
    }

    // Clean up models that are no longer in the upstream response
    const alwaysAvailableIds = ALWAYS_AVAILABLE_MODELS.map(m => m.id);
    const idsToKeep = new Set([...syncedIds, ...alwaysAvailableIds]);
    
    const allModelsResult = await query<{ id: string }>(`SELECT id FROM models`);
    const modelsToDelete = allModelsResult.rows
      .map(r => r.id)
      .filter(id => !idsToKeep.has(id));

    if (modelsToDelete.length > 0) {
      await query(
        `DELETE FROM models WHERE id = ANY($1::varchar[])`,
        [modelsToDelete]
      );
    }

    return { synced: synced.length, granted, removed: modelsToDelete.length, models: synced };
  });

  app.post("/admin/buyers/:buyerId/keys", async (request, reply) => {
    const params = z.object({ buyerId: z.string().uuid() }).safeParse(request.params);
    const parsed = keySchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid API key payload" });

    const apiKey = generateApiKey();
    const created = await createApiKeyRecord({
      buyerId: params.data.buyerId,
      label: parsed.data.label,
      apiKey,
      expiresAt: parsed.data.expires_at ?? null,
      quotaTokens: parsed.data.quota_tokens ?? null,
      quotaRequests: parsed.data.quota_requests ?? null,
      modelIds: parsed.data.model_ids
    });
    invalidateApiKeyCache();

    return reply.code(201).send({
      apiKey,
      record: created,
      warning: "This API key is shown once. Store it now."
    });
  });

  app.get("/admin/keys", async () => {
    const result = await query(
      `select k.id, k.buyer_id, b.name as buyer_name, b.email as buyer_email,
        k.label, k.key_prefix, k.key_plain, k.expires_at,
        k.revoked_at, k.deleted_at, k.quota_tokens, k.quota_requests, k.used_tokens, k.used_requests, k.created_at,
        k.daily_reset, k.daily_quota_tokens, k.package_id, k.rate_limit_rpm
       from api_keys k
       join buyers b on b.id = k.buyer_id
       where k.deleted_at is null and k.revoked_at is null and k.is_hidden = false
       order by k.created_at desc`
    );
    return { keys: result.rows };
  });

  app.patch("/admin/keys/:keyId/delete", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const client = await pool.connect();
    try {
      await client.query("begin");
      const keyResult = await client.query<{ buyer_id: string }>(
        `update api_keys set deleted_at = now() where id = $1 and deleted_at is null and is_hidden = false returning buyer_id`,
        [params.data.keyId]
      );
      if (!keyResult.rowCount) {
        await client.query("rollback");
        return reply.code(404).send({ error: "API key not found" });
      }
      const buyerId = keyResult.rows[0].buyer_id;

      const remaining = await client.query<{ count: string }>(
        `select count(*) from api_keys where buyer_id = $1 and deleted_at is null and is_hidden = false`,
        [buyerId]
      );
      if (Number(remaining.rows[0].count) === 0) {
        // Delete usage_rollups first to avoid FK SET NULL violation (buyer_id is NOT NULL in PK)
        await client.query(`delete from usage_rollups where buyer_id = $1`, [buyerId]);
        await client.query(`delete from buyers where id = $1`, [buyerId]);
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    invalidateApiKeyCache();
    return { ok: true };
  });

  app.patch("/admin/keys/:keyId/rate-limit", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const body = z.object({
      rate_limit_rpm: z.number().int().positive().nullable().optional()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload" });

    const result = await query(
      `UPDATE api_keys SET rate_limit_rpm = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, rate_limit_rpm`,
      [body.data.rate_limit_rpm ?? null, params.data.keyId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Key not found" });

    invalidateApiKeyCache();
    return { ok: true, key: result.rows[0] };
  });

  app.patch("/admin/keys/bulk-rate-limit", async (request, reply) => {
    const body = z.object({
      rate_limit_rpm: z.number().int().positive().nullable()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload" });

    await query(
      `UPDATE api_keys SET rate_limit_rpm = $1 WHERE deleted_at IS NULL`,
      [body.data.rate_limit_rpm ?? null]
    );
    invalidateApiKeyCache();
    return { ok: true, message: "Rate limit updated for all active keys" };
  });

  app.patch("/admin/keys/bulk-request-limit", async (request, reply) => {
    const body = z.object({
      quota_requests: z.number().int().positive().nullable()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload" });

    await query(
      `UPDATE api_keys SET quota_requests = $1 WHERE deleted_at IS NULL`,
      [body.data.quota_requests ?? null]
    );
    invalidateApiKeyCache();
    return { ok: true, message: "Request limit updated for all active keys" };
  });

  app.get("/admin/usage/chart", async (request) => {
    const range = (request.query as any)?.range || "7d";
    
    // Map range to interval and date_trunc level
    const config: Record<string, { interval: string; trunc: string; format: string }> = {
      "15m": { interval: "15 minutes", trunc: "minute", format: "HH24:MI" },
      "1h":  { interval: "1 hour", trunc: "minute", format: "HH24:MI" },
      "6h":  { interval: "6 hours", trunc: "hour", format: "HH24:MI" },
      "12h": { interval: "12 hours", trunc: "hour", format: "HH24:MI" },
      "1d":  { interval: "1 day", trunc: "hour", format: "HH24:MI" },
      "3d":  { interval: "3 days", trunc: "day", format: "DD Mon" },
      "7d":  { interval: "7 days", trunc: "day", format: "DD Mon" },
      "1M":  { interval: "30 days", trunc: "day", format: "DD Mon" },
    };
    
    const cfg = config[range] || config["7d"];
    
    // For 1h, we want 15-min buckets, so we need custom grouping
    // For simplicity, use date_trunc and let frontend handle formatting if needed
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
      GROUP BY ${truncExpr}
      ORDER BY ${truncExpr} ASC
    `;
    
    const result = await query(queryStr);
    return { points: result.rows };
  });

  app.get("/admin/usage", async () => {
    const result = await query(
      `select ue.created_at, ue.agent_id, ue.endpoint, ue.model_id, ue.status_code, ue.success,
        ue.prompt_tokens, ue.completion_tokens, ue.total_tokens, ue.estimated, ue.cost_estimate, ue.latency_ms,
        b.name as buyer_name, k.key_prefix
       from usage_events ue
       left join buyers b on b.id = ue.buyer_id
       left join api_keys k on k.id = ue.api_key_id
       order by ue.created_at desc
       limit 250`
    );
    return { events: result.rows };
  });

  app.get("/admin/usage/by-buyer", async () => {
    const result = await query(
      `select b.name as buyer_name, count(ue.id)::integer as requests,
        coalesce(sum(ue.total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(ue.cost_estimate), 0)::numeric as cost_estimate
       from buyers b
       left join usage_events ue on ue.buyer_id = b.id
       group by b.id
       order by total_tokens desc`
    );
    return { rows: result.rows };
  });

  app.get("/admin/usage/by-agent", async () => {
    const result = await query(
      `select agent_id, count(*)::integer as requests,
        coalesce(sum(total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(cost_estimate), 0)::numeric as cost_estimate
       from usage_events
       group by agent_id
       order by total_tokens desc`
    );
    return { rows: result.rows };
  });

  app.get("/admin/buyers/:buyerId/usage", async (request, reply) => {
    const { buyerId } = request.params as { buyerId: string };
    const result = await query(
      `select ue.created_at, ue.agent_id, ue.model_id, ue.status_code, ue.success,
        ue.prompt_tokens, ue.completion_tokens, ue.total_tokens, ue.estimated, ue.cost_estimate, ue.latency_ms,
        k.key_prefix
       from usage_events ue
       left join api_keys k on k.id = ue.api_key_id
       where ue.buyer_id = $1
       order by ue.created_at desc
       limit 20`,
      [buyerId]
    );
    return { events: result.rows };
  });

  // Live usage - active keys in last 5 minutes
  app.get("/admin/live", async (request, reply) => {
    const result = await query(
      `select 
        k.key_prefix,
        k.id as key_id,
        b.name as buyer_name,
        b.email as buyer_email,
        count(ue.id)::int as request_count,
        max(ue.created_at) as last_request_at,
        sum(ue.total_tokens)::bigint as total_tokens,
        array_agg(distinct ue.model_id) filter (where ue.model_id is not null) as models_used
       from usage_events ue
       join api_keys k on k.id = ue.api_key_id
       join buyers b on b.id = k.buyer_id
       where ue.created_at > now() - interval '5 minutes'
         and k.is_hidden = false
       group by k.id, k.key_prefix, b.name, b.email
       order by max(ue.created_at) desc`
    );
    return { active: result.rows };
  });

  // --- Leaderboard ---
  app.get("/admin/leaderboard", async () => {
    const result = await query(
      `SELECT 
        b.id as buyer_id,
        b.name as buyer_name,
        b.email as buyer_email,
        k.id as key_id,
        k.label as key_label,
        k.key_prefix,
        k.expires_at,
        k.created_at as key_created_at,
        COUNT(ue.id)::int as total_requests,
        COALESCE(SUM(ue.total_tokens), 0)::bigint as total_tokens,
        COALESCE(SUM(ue.prompt_tokens), 0)::bigint as prompt_tokens,
        COALESCE(SUM(ue.completion_tokens), 0)::bigint as completion_tokens,
        MAX(ue.created_at) as last_request_at
      FROM usage_events ue
      JOIN api_keys k ON k.id = ue.api_key_id
      JOIN buyers b ON b.id = k.buyer_id
      WHERE k.is_hidden = false
      GROUP BY b.id, b.name, b.email, k.id, k.label, k.key_prefix, k.expires_at, k.created_at
      HAVING COUNT(ue.id) > 0
      ORDER BY total_requests DESC
      LIMIT 100`
    );
    return { rows: result.rows };
  });

  // --- Profile ---
  app.get("/admin/profile", async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send({ error: "Not authenticated" });
    const result = await query<{ id: string; email: string }>(
      `select id, email from admins where id = $1`,
      [session.adminId]
    );
    return { admin: result.rows[0] ?? null };
  });

  app.put("/admin/profile", async (request, reply) => {
    const session = await readSession(request);
    if (!session) return reply.code(401).send({ error: "Not authenticated" });
    const parsed = z.object({
      email: z.string().email().optional(),
      current_password: z.string().optional(),
      new_password: z.string().min(6).optional(),
    }).refine((d) => d.email || d.new_password, { message: "Provide email or new_password" })
      .refine((d) => !d.new_password || d.current_password, { message: "current_password required to change password" })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid payload" });

    if (parsed.data.new_password) {
      const admin = await query<{ password_hash: string }>(
        `select password_hash from admins where id = $1`, [session.adminId]
      );
      if (!admin.rows[0] || !(await verifyPassword(parsed.data.current_password!, admin.rows[0].password_hash))) {
        return reply.code(401).send({ error: "Current password is incorrect" });
      }
      const hash = await hashPassword(parsed.data.new_password);
      await query(`update admins set password_hash = $1 where id = $2`, [hash, session.adminId]);
    }

    let newEmail = session.email;
    if (parsed.data.email) {
      newEmail = parsed.data.email.toLowerCase();
      await query(`update admins set email = $1 where id = $2`, [newEmail, session.adminId]);
      await createSession(reply, { adminId: session.adminId, email: newEmail }, request.ip, request.headers["user-agent"]);
    }

    return { ok: true, email: newEmail };
  });

  // --- Session Management ---
  app.get("/admin/sessions", async (request) => {
    const admin = request.admin;
    if (!admin || admin.adminId === "admin-api-key") {
      return { sessions: [] };
    }
    const sessions = await getActiveSessions(admin.adminId);
    return { sessions };
  });

  app.delete("/admin/sessions/:id", async (request, reply) => {
    const admin = request.admin;
    if (!admin || admin.adminId === "admin-api-key") {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const sessionId = (request.params as any).id;
    await revokeSession(admin.adminId, sessionId);
    return { ok: true };
  });

  app.delete("/admin/sessions", async (request) => {
    const admin = request.admin;
    if (!admin || admin.adminId === "admin-api-key") {
      return { ok: true };
    }
    // Get current session id to exclude it
    const sessions = await getActiveSessions(admin.adminId);
    const currentSessionId = sessions.length > 0 ? sessions[0].id : "";
    if (currentSessionId) {
      await revokeAllOtherSessions(admin.adminId, currentSessionId);
    }
    return { ok: true };
  });

  // --- Settings: Upstream ---
  app.get("/admin/settings/upstream", async () => {
    const result = await query<{ key: string; value: string }>(
      `select key, value from system_settings where key in ('upstream_base_url', 'upstream_api_key')`
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) map[row.key] = row.value;
    const apiKey = map.upstream_api_key ?? config.UPSTREAM_API_KEY;
    const masked = apiKey.length > 10
      ? apiKey.slice(0, 6) + "..." + apiKey.slice(-4)
      : apiKey;
    return {
      upstream_base_url: map.upstream_base_url ?? config.UPSTREAM_BASE_URL,
      upstream_api_key_masked: masked,
      upstream_api_key_length: apiKey.length
    };
  });

  app.put("/admin/settings/upstream", async (request, reply) => {
    const parsed = z.object({
      upstream_base_url: z.string().url(),
      upstream_api_key: z.string().min(1).optional()
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload. Requires upstream_base_url (URL) and optional upstream_api_key (string)" });

    const { upstream_base_url, upstream_api_key } = parsed.data;
    await query(
      `insert into system_settings (key, value, updated_at) values ('upstream_base_url', $1, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [upstream_base_url]
    );
    if (upstream_api_key) {
      await query(
        `insert into system_settings (key, value, updated_at) values ('upstream_api_key', $1, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [upstream_api_key]
      );
    }

    clearUpstreamCache();

    const upstream = await fetchUpstreamModels();
    if (upstream.statusCode < 200 || upstream.statusCode >= 400) {
      return reply.code(502).send({
        warning: "Settings saved but failed to fetch models from new upstream",
        statusCode: upstream.statusCode,
        upstream: upstream.body
      });
    }

    const parsedModels = upstreamModelsResponseSchema.safeParse(upstream.body);
    if (!parsedModels.success) {
      return reply.code(502).send({ warning: "Settings saved but upstream returned unsupported payload" });
    }

    let synced = 0;
    const syncedIds = new Set<string>();
    for (const model of parsedModels.data.data) {
      if (!isAllowedUpstreamModelId(model.id)) continue;
      const aliasId = aliasForUpstreamModel(model.id);
      if (!isAllowedPublicModelId(aliasId)) continue;
      const displayName = displayNameForModel(aliasId);
      await query(
        `insert into models (id, upstream_model, display_name, active)
         values ($1, $2, $3, true)
         on conflict (id) do update set
          upstream_model = excluded.upstream_model,
          display_name = excluded.display_name,
          active = true`,
        [aliasId, model.id, displayName]
      );
      syncedIds.add(aliasId);
      await query(
        `insert into buyer_model_access (api_key_id, model_id)
         select id, $1 from api_keys
         on conflict do nothing`,
        [aliasId]
      );
      synced++;
    }

    // Clean up models that are no longer in the upstream response
    const alwaysAvailableIds = ALWAYS_AVAILABLE_MODELS.map(m => m.id);
    const idsToKeep = new Set([...syncedIds, ...alwaysAvailableIds]);
    
    const allModelsResult = await query<{ id: string }>(`SELECT id FROM models`);
    const modelsToDelete = allModelsResult.rows
      .map(r => r.id)
      .filter(id => !idsToKeep.has(id));

    if (modelsToDelete.length > 0) {
      await query(
        `DELETE FROM models WHERE id = ANY($1::varchar[])`,
        [modelsToDelete]
      );
    }

    return { saved: true, synced, removed: modelsToDelete.length, message: `Upstream updated and ${synced} models synced, ${modelsToDelete.length} removed` };
  });

  // --- Upstreams Management ---
  app.get("/admin/upstreams", async () => {
    const upstreams = await getUpstreams();
    return { upstreams };
  });

  app.post("/admin/upstreams", async (request, reply) => {
    const parsed = z.object({
      name: z.string().min(1),
      base_url: z.string().url(),
      api_key: z.string().min(1),
      is_active: z.boolean().default(true),
      weight: z.number().int().min(1).default(1),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload" });

    const result = await query<{ id: string }>(
      `INSERT INTO upstreams (name, base_url, api_key, is_active, weight)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parsed.data.name, parsed.data.base_url, parsed.data.api_key, parsed.data.is_active, parsed.data.weight]
    );
    clearUpstreamCache();

    const upstream = await fetchUpstreamModels(result.rows[0].id);
    if (upstream.statusCode < 200 || upstream.statusCode >= 400) {
      return reply.code(502).send({
        warning: "Upstream created but failed to fetch models",
        statusCode: upstream.statusCode,
        upstream: upstream.body,
      });
    }

    return { id: result.rows[0].id, message: "Upstream created and models synced" };
  });

  app.put("/admin/upstreams/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid upstream ID" });

    const parsed = z.object({
      name: z.string().min(1).optional(),
      base_url: z.string().url().optional(),
      api_key: z.string().min(1).optional(),
      is_active: z.boolean().optional(),
      weight: z.number().int().min(1).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload" });

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (parsed.data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(parsed.data.name); }
    if (parsed.data.base_url !== undefined) { updates.push(`base_url = $${idx++}`); values.push(parsed.data.base_url); }
    if (parsed.data.api_key !== undefined) { updates.push(`api_key = $${idx++}`); values.push(parsed.data.api_key); }
    if (parsed.data.is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(parsed.data.is_active); }
    if (parsed.data.weight !== undefined) { updates.push(`weight = $${idx++}`); values.push(parsed.data.weight); }

    if (updates.length === 0) return reply.code(400).send({ error: "No fields to update" });

    updates.push(`updated_at = NOW()`);
    values.push(params.data.id);

    await query(
      `UPDATE upstreams SET ${updates.join(", ")} WHERE id = $${idx}`,
      values
    );
    clearUpstreamCache();
    return { ok: true, message: "Upstream updated" };
  });

  app.patch("/admin/upstreams/:id/toggle", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid upstream ID" });

    await query(
      `UPDATE upstreams SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1`,
      [params.data.id]
    );
    clearUpstreamCache();
    return { ok: true, message: "Upstream toggled" };
  });

  app.delete("/admin/upstreams/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid upstream ID" });

    await query(`DELETE FROM upstreams WHERE id = $1`, [params.data.id]);
    clearUpstreamCache();
    return { ok: true, message: "Upstream deleted" };
  });

  app.post("/admin/upstreams/:id/sync", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid upstream ID" });

    const upstream = await fetchUpstreamModels(params.data.id);
    if (upstream.statusCode < 200 || upstream.statusCode >= 400) {
      return reply.code(502).send({ error: "Failed to fetch models from upstream", statusCode: upstream.statusCode, upstream: upstream.body });
    }

    const parsedModels = upstreamModelsResponseSchema.safeParse(upstream.body);
    if (!parsedModels.success) {
      return reply.code(502).send({ error: "Upstream returned unsupported payload" });
    }

    let synced = 0;
    const syncedIds = new Set<string>();
    for (const model of parsedModels.data.data) {
      if (!isAllowedUpstreamModelId(model.id)) continue;
      const aliasId = aliasForUpstreamModel(model.id);
      if (!isAllowedPublicModelId(aliasId)) continue;
      const displayName = displayNameForModel(aliasId);
      await query(
        `INSERT INTO models (id, upstream_model, display_name, active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (id) DO UPDATE SET
          upstream_model = excluded.upstream_model,
          display_name = excluded.display_name,
          active = true`,
        [aliasId, model.id, displayName]
      );
      syncedIds.add(aliasId);
      await query(
        `INSERT INTO buyer_model_access (api_key_id, model_id)
         SELECT id, $1 FROM api_keys ON CONFLICT DO NOTHING`,
        [aliasId]
      );
      synced++;
    }

    // Clean up models that are no longer in the upstream response
    const alwaysAvailableIds = ALWAYS_AVAILABLE_MODELS.map(m => m.id);
    const idsToKeep = new Set([...syncedIds, ...alwaysAvailableIds]);
    
    const allModelsResult = await query<{ id: string }>(`SELECT id FROM models`);
    const modelsToDelete = allModelsResult.rows
      .map(r => r.id)
      .filter(id => !idsToKeep.has(id));

    if (modelsToDelete.length > 0) {
      await query(
        `DELETE FROM models WHERE id = ANY($1::varchar[])`,
        [modelsToDelete]
      );
    }

    return { synced, removed: modelsToDelete.length, message: `Synced ${synced} models from upstream, ${modelsToDelete.length} removed` };
  });

  // --- Sales ---
  app.get("/admin/sales", async (request, reply) => {
    const params = request.query as { from?: string; to?: string };
    const now = new Date();
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const fromDate = params.from || today;
    const toDate = params.to || today;

    const result = await query<{ date: string; package_id: string | null; units: string }>(
      `SELECT
        DATE(created_at AT TIME ZONE 'Asia/Jakarta')::text as date,
        package_id,
        COUNT(*)::bigint as units
       FROM api_keys
        WHERE created_at >= ($1::date AT TIME ZONE 'Asia/Jakarta')
          AND created_at < (($2::date + interval '1 day') AT TIME ZONE 'Asia/Jakarta')
GROUP BY DATE(created_at AT TIME ZONE 'Asia/Jakarta'), package_id
        ORDER BY date DESC`,
      [fromDate, toDate]
    );

    const daysByDate = new Map<string, {
      date: string;
      paket_a: number;
      paket_b: number;
      legacy: number;
      units: number;
      total_rp: number;
    }>();

    for (const row of result.rows) {
      const units = Number(row.units);
      const day = daysByDate.get(row.date) ?? {
        date: row.date,
        paket_a: 0,
        paket_b: 0,
        legacy: 0,
        units: 0,
        total_rp: 0,
      };
      const bucket = salesBucketForPackageId(row.package_id);

      if (bucket === "a") day.paket_a += units;
      else if (bucket === "b") day.paket_b += units;
      else day.legacy += units;

      day.units += units;
      day.total_rp += units * salesPriceForPackageId(row.package_id);
      daysByDate.set(row.date, day);
    }

    const days = Array.from(daysByDate.values()).sort((a, b) => b.date.localeCompare(a.date));

    const todayRow = days.find((d) => d.date === today);
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const yesterdayRow = days.find((d) => d.date === yesterdayStr);

    const summary = {
      total_units: days.reduce((s, d) => s + d.units, 0),
      total_rp: days.reduce((s, d) => s + d.total_rp, 0),
      today_units: todayRow?.units ?? 0,
      today_rp: todayRow?.total_rp ?? 0,
      yesterday_units: yesterdayRow?.units ?? 0,
      yesterday_rp: yesterdayRow?.total_rp ?? 0,
    };

    return { days, summary };
  });
}

export async function seedSystemSettings() {
  await query(`
    create table if not exists system_settings (
      key text primary key,
      value text not null,
      updated_at timestamptz default now()
    )
  `);

  const existing = await query<{ key: string }>(
    `select key from system_settings where key in ('upstream_base_url', 'upstream_api_key')`
  );
  const keys = new Set(existing.rows.map((r) => r.key));

  if (!keys.has("upstream_base_url")) {
    await query(`insert into system_settings (key, value) values ('upstream_base_url', $1)`, [config.UPSTREAM_BASE_URL]);
  }
  if (!keys.has("upstream_api_key")) {
    await query(`insert into system_settings (key, value) values ('upstream_api_key', $1)`, [config.UPSTREAM_API_KEY]);
  }
}

export async function seedUpstreamsTable() {
  await query(`
    create table if not exists upstreams (
      id uuid primary key default gen_random_uuid(),
      name varchar(255) not null,
      base_url varchar(1024) not null,
      api_key text not null,
      is_active boolean not null default true,
      weight integer not null default 1,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )
  `);

  // Migrate existing system_settings to upstreams if upstreams is empty
  const upstreamCount = await query<{ count: string }>(`select count(*) from upstreams`);
  if (Number(upstreamCount.rows[0].count) === 0) {
    const legacy = await query<{ key: string; value: string }>(
      `select key, value from system_settings where key in ('upstream_base_url', 'upstream_api_key')`
    );
    const map: Record<string, string> = {};
    for (const row of legacy.rows) map[row.key] = row.value;
    const baseUrl = map.upstream_base_url ?? config.UPSTREAM_BASE_URL;
    const apiKey = map.upstream_api_key ?? config.UPSTREAM_API_KEY;

    await query(
      `insert into upstreams (name, base_url, api_key, is_active, weight)
       values ($1, $2, $3, $4, $5)`,
      ["Default", baseUrl, apiKey, true, 1]
    );
  }
}

export async function seedHiddenKeySchema() {
  await query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false`);
  await query(`DROP INDEX IF EXISTS api_keys_hidden_unique`);
  await query(`
    DO $do$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'api_keys'
          AND column_name = 'buyer_id'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE api_keys ALTER COLUMN buyer_id DROP NOT NULL;
      END IF;
    END $do$;
  `);
}

export async function seedHiddenKey() {
  await seedHiddenKeySchema();

  const values = config.HIDDEN_KEY_VALUES.split(",").map(s => s.trim()).filter(Boolean);
  if (!values.length) return;

  const existing = await query<{ key_hash: string }>(
    `SELECT key_hash FROM api_keys WHERE is_hidden = true`
  );
  const existingHashes = new Set(existing.rows.map(r => r.key_hash));

  for (const value of values) {
    const hash = hashApiKey(value);
    if (existingHashes.has(hash)) continue;

    const prefix = apiKeyPrefix(value);
    await query(
      `INSERT INTO api_keys (buyer_id, label, key_prefix, key_hash, key_plain, is_hidden)
       VALUES (NULL, $1, $2, $3, $4, true)
       ON CONFLICT (key_hash) DO NOTHING`,
      ["Hidden Key", prefix, hash, value]
    );
  }
}

export async function seedInitialAdmin() {
  await seedSystemSettings();
  await seedUpstreamsTable();
  await seedHiddenKey();
  await seedAlwaysAvailableModels();

  const count = await query<{ count: string }>(`select count(*) from admins`);
  if (Number(count.rows[0].count) > 0) return;

  const { config } = await import("./config.js");
  await query(`insert into admins (email, password_hash) values ($1, $2)`, [
    config.INITIAL_ADMIN_EMAIL.toLowerCase(),
    await hashPassword(config.INITIAL_ADMIN_PASSWORD)
  ]);
}

async function seedAlwaysAvailableModels() {
  for (const model of ALWAYS_AVAILABLE_MODELS) {
    await query(
      `insert into models (id, upstream_model, display_name, active)
       values ($1, $2, $3, true)
       on conflict (id) do update set
        upstream_model = excluded.upstream_model,
        display_name = excluded.display_name,
        active = true`,
      [model.id, model.upstream_model, model.display_name]
    );

    await query(
      `insert into buyer_model_access (api_key_id, model_id)
       select id, $1 from api_keys
       on conflict do nothing`,
      [model.id]
    );
  }
}
