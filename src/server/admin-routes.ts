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
import { createApiKeyRecord, invalidateApiKeyCache } from "./repositories.js";
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
  MODEL_ACCESS_ROLES,
  normalizeAccessRoles,
  type ModelAccessRole,
  ULTRA_QUOTA_TOKENS,
} from "../shared/buyer-roles.js";
import {
  CREATE_KEY_PACKAGE_IDS,
  CREATE_KEY_PACKAGES_BY_ID,
  DEFAULT_CREATE_KEY_PACKAGE_ID
} from "../shared/package-catalog.js";

/** Get current time in Indonesia (WIB/GMT+7) as ISO string */
function nowMYT(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1)
});

const modelAccessRoleSchema = z.enum(MODEL_ACCESS_ROLES);

const modelSchema = z.object({
  id: z.string().min(1),
  upstream_model: z.string().min(1),
  display_name: z.string().min(1),
  active: z.boolean().default(true),
  input_cost_per_million: z.number().optional().nullable(),
  output_cost_per_million: z.number().optional().nullable(),
  quota_exempt: z.boolean().optional().default(false),
  // Restricted roles that may use this model. Empty = all keys.
  // Each role can be toggled independently: dev | supporter | ultra.
  access_roles: z.array(modelAccessRoleSchema).optional().default([]),
  // Legacy mirror of access_roles.length > 0 (kept for older clients).
  privileged_only: z.boolean().optional()
});

const modelPatchSchema = z.object({
  display_name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  quota_exempt: z.boolean().optional(),
  access_roles: z.array(modelAccessRoleSchema).optional(),
  // Legacy: true → dev+supporter; false → open to all. Prefer access_roles.
  privileged_only: z.boolean().optional(),
  input_cost_per_million: z.number().optional().nullable(),
  output_cost_per_million: z.number().optional().nullable(),
  upstream_model: z.string().min(1).optional()
}).refine(
  (body) => Object.keys(body).length > 0,
  { message: "At least one field required" }
);

const keySchema = z.object({
  label: z.string().min(1),
  expires_at: z.string().datetime().optional().nullable(),
  quota_tokens: z.number().int().positive().optional().nullable(),
  quota_requests: z.number().int().positive().optional().nullable(),
  model_ids: z.array(z.string()).min(1)
});

// Model internal/combo sudah tidak dipakai — kosongkan agar tidak di-seed/di-keep lagi.
// Model dari upstream (MiniMax, Alibaba, dll) dikelola otomatis oleh proses sync:
// - Jika upstream return model -> otomatis masuk DB (active = true)
// - Jika upstream tidak return -> otomatis dihapus dari DB saat sync
type AlwaysAvailableModel = { id: string; upstream_model: string; display_name: string };
const ALWAYS_AVAILABLE_MODELS: AlwaysAvailableModel[] = [];

// Create API Key from public Prices packages (Starter/Pro/Business/Ultra).
// packageId drives quota_tokens + rate_limit_rpm; days defaults to package.defaultDays (28).
const createKeySchema = z.object({
  name: z.string().min(1),
  days: z.number().int().positive().optional(),
  packageId: z.enum(CREATE_KEY_PACKAGE_IDS).default(DEFAULT_CREATE_KEY_PACKAGE_ID),
  unlimitedQuota: z.boolean().optional().default(false),
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

/** Active models auto-granted to new keys. Excludes role-restricted models. */
async function activeAllowedModelIds() {
  const result = await query<{ id: string }>(
    `select id
     from models
     where active = true
       and id like 'routers9/%'
       and cardinality(coalesce(access_roles, '{}'::text[])) = 0
     order by display_name asc`
  );
  return result.rows.map((row) => row.id);
}

/** Key ids matching one or more access roles (union).
 *  Checks both name-match (legacy) AND per-key access_roles DB column.
 */
async function keyIdsForAccessRoles(roles: ModelAccessRole[]): Promise<string[]> {
  const normalized = normalizeAccessRoles(roles);
  if (!normalized.length) return [];

  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (normalized.includes("dev")) {
    // Name-match (legacy) OR explicit access_roles column
    conditions.push(`lower(trim(b.name)) = $${i++}`);
    params.push("super admin");
    conditions.push(`$${i++} = any(coalesce(k.access_roles, '{}'::text[]))`);
    params.push("dev");
  }
  if (normalized.includes("supporter")) {
    conditions.push(`lower(trim(b.name)) = any($${i++}::text[])`);
    params.push(["gilbert arias", "yuop", "attta rebelution", "aditya sandy", "dono"]);
    conditions.push(`$${i++} = any(coalesce(k.access_roles, '{}'::text[]))`);
    params.push("supporter");
  }
  if (normalized.includes("ultra")) {
    // Ultra role: is_ultra flag OR access_roles column OR legacy 500M quota
    conditions.push(`(k.is_ultra = true or k.quota_tokens = $${i++} or $${i++} = any(coalesce(k.access_roles, '{}'::text[])))`);
    params.push(ULTRA_QUOTA_TOKENS);
    params.push("ultra");
  }

  const result = await query<{ id: string }>(
    `select distinct k.id
     from api_keys k
     left join buyers b on b.id = k.buyer_id
     where k.deleted_at is null
       and (${conditions.join(" or ")})`,
    params
  );
  return result.rows.map((row) => row.id);
}

/**
 * Apply buyer_model_access for a model based on access_roles.
 * - Empty roles: open to all non-deleted keys.
 * - Non-empty: grant only matching role keys; strip everyone else.
 * Also keeps privileged_only mirror in sync.
 */
async function applyModelAccessRoles(modelId: string, rolesInput: unknown) {
  const roles = normalizeAccessRoles(rolesInput);
  const restricted = roles.length > 0;

  await query(
    `update models
     set access_roles = $2::text[],
         privileged_only = $3
     where id = $1`,
    [modelId, roles, restricted]
  );

  if (!restricted) {
    await query(
      `insert into buyer_model_access (api_key_id, model_id)
       select id, $1 from api_keys
       where deleted_at is null
       on conflict do nothing`,
      [modelId]
    );
    return roles;
  }

  const keyIds = await keyIdsForAccessRoles(roles);
  if (keyIds.length) {
    await query(
      `insert into buyer_model_access (api_key_id, model_id)
       select unnest($1::uuid[]), $2
       on conflict do nothing`,
      [keyIds, modelId]
    );
  }

  if (keyIds.length) {
    await query(
      `delete from buyer_model_access
       where model_id = $1
         and not (api_key_id = any($2::uuid[]))`,
      [modelId, keyIds]
    );
  } else {
    // No matching keys yet — strip all access until someone qualifies.
    await query(`delete from buyer_model_access where model_id = $1`, [modelId]);
  }

  return roles;
}

/** Re-apply access for a model using its current DB access_roles. */
async function reapplyModelAccessFromDb(modelId: string) {
  const row = await query<{ access_roles: string[] | null; privileged_only: boolean }>(
    `select access_roles, coalesce(privileged_only, false) as privileged_only
     from models where id = $1`,
    [modelId]
  );
  const current = row.rows[0];
  if (!current) return;
  let roles = normalizeAccessRoles(current.access_roles);
  // Legacy fallback: privileged_only without roles → dev+supporter
  if (!roles.length && current.privileged_only) {
    roles = ["dev", "supporter"];
  }
  await applyModelAccessRoles(modelId, roles);
}

/** Restricted models that include a given role (for create-key / quota change). */
async function modelIdsWithAccessRole(role: ModelAccessRole): Promise<string[]> {
  const result = await query<{ id: string }>(
    `select id from models
     where active = true
       and $1 = any(coalesce(access_roles, '{}'::text[]))`,
    [role]
  );
  return result.rows.map((r) => r.id);
}

/** After key role changes (e.g. become Ultra), re-sync restricted model grants for that key. */
async function syncKeyRestrictedModelAccess(apiKeyId: string) {
  // Grant any restricted model whose roles match this key; strip ones that no longer match.
  const models = await query<{ id: string; access_roles: string[] | null }>(
    `select id, access_roles from models
     where cardinality(coalesce(access_roles, '{}'::text[])) > 0`
  );
  for (const m of models.rows) {
    const roles = normalizeAccessRoles(m.access_roles);
    const allowedIds = await keyIdsForAccessRoles(roles);
    if (allowedIds.includes(apiKeyId)) {
      await query(
        `insert into buyer_model_access (api_key_id, model_id) values ($1, $2)
         on conflict do nothing`,
        [apiKeyId, m.id]
      );
    } else {
      await query(
        `delete from buyer_model_access where api_key_id = $1 and model_id = $2`,
        [apiKeyId, m.id]
      );
    }
  }
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
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid payload. Requires name (string) and packageId (starter|pro|business|ultra); days optional positive int"
      });
    }

    const pkg = CREATE_KEY_PACKAGES_BY_ID[parsed.data.packageId];
    if (!pkg) {
      return reply.code(400).send({ error: "Unknown packageId" });
    }

    const days = parsed.data.days ?? pkg.defaultDays;
    if (!Number.isInteger(days) || days <= 0) {
      return reply.code(400).send({ error: "days must be a positive integer" });
    }

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
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const label = `${pkg.label} · ${days} hari`;

    const modelIds = await activeAllowedModelIds();
    // Ultra role is a dedicated flag on the package; grant ultra-restricted models.
    const isUltraPackage = pkg.id === "ultra";
    if (isUltraPackage) {
      const ultraModels = await modelIdsWithAccessRole("ultra");
      for (const id of ultraModels) {
        if (!modelIds.includes(id)) modelIds.push(id);
      }
    }
    if (!modelIds.length) {
      return reply.code(500).send({ error: "No active white-label models are configured" });
    }

    const keyRecord = await createApiKeyRecord({
      buyerId,
      label,
      apiKey,
      expiresAt,
      quotaTokens: parsed.data.unlimitedQuota ? null : pkg.quotaTokens,
      quotaRequests: null,
      modelIds,
      dailyReset: false,
      dailyQuotaTokens: null,
      packageId: pkg.id,
      rateLimitRpm: pkg.rateLimitRpm,
      isUltra: isUltraPackage
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
      days,
      package: {
        id: pkg.id,
        label: pkg.label,
        quota_tokens: parsed.data.unlimitedQuota ? null : pkg.quotaTokens,
        daily_quota_tokens: null,
        daily_reset: false,
        rate_limit_rpm: pkg.rateLimitRpm,
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

  // --- Add days to key expiry (per-key) ---
  app.post("/admin/keys/:keyId/add-days", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const body = z.object({ days: z.number().int().min(1).max(3650) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { days: number (1-3650) }" });

    const result = await query<{ id: string; expires_at: string }>(
      `UPDATE api_keys SET expires_at = GREATEST(expires_at, NOW()) + make_interval(days => $1) WHERE id = $2 AND deleted_at IS NULL AND expires_at IS NOT NULL RETURNING id, expires_at`,
      [body.data.days, params.data.keyId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Key not found or has no expiry" });

    return { key: result.rows[0], days_added: body.data.days };
  });

  // --- Add days to key expiry (bulk) ---
  app.post("/admin/keys/add-days", async (request, reply) => {
    const body = z.object({
      all: z.boolean().optional(),
      keyIds: z.array(z.string().uuid()).optional(),
      days: z.number().int().min(1).max(3650)
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { days, all?: true, keyIds?: string[] }" });

    const { all, keyIds, days } = body.data;
    if (!all && (!keyIds || keyIds.length === 0)) {
      return reply.code(400).send({ error: "Must provide 'all: true' or 'keyIds' array" });
    }

    let result;
    const activeFilter = `deleted_at IS NULL AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at > NOW() AND is_hidden = false`;

    if (all) {
      result = await query(
        `UPDATE api_keys SET expires_at = expires_at + make_interval(days => $1) WHERE ${activeFilter}`,
        [days]
      );
    } else {
      result = await query(
        `UPDATE api_keys SET expires_at = expires_at + make_interval(days => $1) WHERE id = ANY($2) AND ${activeFilter}`,
        [days, keyIds]
      );
    }

    return { updated: result.rowCount || 0, days_added: days };
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
    // Only finite-quota keys. Unlimited (quota_tokens IS NULL) must stay unlimited —
    // COALESCE(NULL,0)+N would silently demote them to a tiny cap.
    // Daily-reset keys also bump daily_quota_tokens.
    const baseFilter = `deleted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND is_hidden = false AND quota_tokens IS NOT NULL`;
    const setClause = `quota_tokens = COALESCE(quota_tokens, 0) + $1,
                       daily_quota_tokens = CASE
                         WHEN daily_reset = true THEN COALESCE(daily_quota_tokens, quota_tokens, 0) + $1
                         ELSE daily_quota_tokens
                       END`;

    if (all) {
      result = await query(
        `UPDATE api_keys SET ${setClause} WHERE ${baseFilter}`,
        [tokens]
      );
    } else {
      result = await query(
        `UPDATE api_keys SET ${setClause} WHERE id = ANY($2) AND ${baseFilter}`,
        [tokens, keyIds]
      );
    }

    invalidateApiKeyCache();
    return { updated: result.rowCount || 0, tokens_added: tokens };
  });

  app.get("/admin/overview", async () => {
    const [buyers, keys, usage, totalKeys] = await Promise.all([
      query<{ count: string }>(`select count(*) from buyers`),
      query<{ count: string }>(`select count(*) from api_keys where deleted_at is null and revoked_at is null and is_hidden = false`),
      query<{ requests: string; tokens: string; cost: string }>(
        `select count(*) as requests, coalesce(sum(total_tokens), 0) as tokens, coalesce(sum(cost_estimate), 0) as cost
         from usage_events WHERE status_code != 400`
      ),
      query<{ count: string }>(`select count(*) from api_keys where is_hidden = false`)
    ]);

    return {
      buyers: Number(buyers.rows[0].count),
      activeKeys: Number(keys.rows[0].count),
      totalKeys: Number(totalKeys.rows[0].count),
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

  app.get("/admin/models", async () => {
    const result = await query(`select * from models where id not like 'kr/%' order by display_name asc`);
    return { models: result.rows };
  });

  app.post("/admin/models", async (request, reply) => {
    const parsed = modelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid model payload" });

    const model = parsed.data;
    const roles = normalizeAccessRoles(
      model.access_roles ??
        (model.privileged_only ? (["dev", "supporter"] as ModelAccessRole[]) : [])
    );
    const result = await query(
      `insert into models
       (id, upstream_model, display_name, active, input_cost_per_million, output_cost_per_million, quota_exempt, privileged_only, access_roles)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])
       on conflict (id) do update set
        upstream_model = excluded.upstream_model,
        display_name = excluded.display_name,
        active = excluded.active,
        input_cost_per_million = excluded.input_cost_per_million,
        output_cost_per_million = excluded.output_cost_per_million,
        quota_exempt = excluded.quota_exempt,
        privileged_only = excluded.privileged_only,
        access_roles = excluded.access_roles
       returning *`,
      [
        model.id,
        model.upstream_model,
        model.display_name,
        model.active,
        model.input_cost_per_million ?? null,
        model.output_cost_per_million ?? null,
        model.quota_exempt ?? false,
        roles.length > 0,
        roles
      ]
    );
    await applyModelAccessRoles(model.id, roles);
    const refreshed = await query(`select * from models where id = $1`, [model.id]);
    return { model: refreshed.rows[0] ?? result.rows[0] };
  });

  app.patch("/admin/models/*", async (request, reply) => {
    const star = (request.params as { "*": string })["*"];
    const modelId = decodeURIComponent(star || "").replace(/^\/+/, "");
    if (!modelId) return reply.code(400).send({ error: "Invalid model id" });

    const body = modelPatchSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid model patch", details: body.error.flatten() });
    }

    const existing = await query<{ access_roles: string[] | null; privileged_only: boolean }>(
      `SELECT id, access_roles, coalesce(privileged_only, false) as privileged_only FROM models WHERE id = $1 LIMIT 1`,
      [modelId]
    );
    if (!existing.rows[0]) return reply.code(404).send({ error: "Model not found" });

    // Resolve access_roles from explicit list or legacy privileged_only toggle.
    let nextRoles: ModelAccessRole[] | undefined;
    if (body.data.access_roles !== undefined) {
      nextRoles = normalizeAccessRoles(body.data.access_roles);
    } else if (body.data.privileged_only !== undefined) {
      if (body.data.privileged_only) {
        const current = normalizeAccessRoles(existing.rows[0].access_roles);
        nextRoles = current.length ? current : (["dev", "supporter"] as ModelAccessRole[]);
      } else {
        nextRoles = [];
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(body.data)) {
      if (value === undefined) continue;
      // access_roles / privileged_only applied via applyModelAccessRoles below
      if (key === "access_roles" || key === "privileged_only") continue;
      fields.push(`${key} = $${i++}`);
      values.push(value);
    }

    if (fields.length) {
      values.push(modelId);
      await query(
        `UPDATE models SET ${fields.join(", ")} WHERE id = $${i}`,
        values
      );
    } else if (nextRoles === undefined) {
      return reply.code(400).send({ error: "No fields to update" });
    }

    if (nextRoles !== undefined) {
      await applyModelAccessRoles(modelId, nextRoles);
    }

    const result = await query(`SELECT * FROM models WHERE id = $1`, [modelId]);
    return { model: result.rows[0] };
  });

  app.delete("/admin/models/*", async (request, reply) => {
    const star = (request.params as { "*": string })["*"];
    const modelId = decodeURIComponent(star || "").replace(/^\/+/, "");
    if (!modelId) return reply.code(400).send({ error: "Invalid model id" });

    const accessCount = await query<{ count: string }>(
      `SELECT count(*)::text as count FROM buyer_model_access WHERE model_id = $1`,
      [modelId]
    );
    const result = await query(`DELETE FROM models WHERE id = $1 RETURNING id, display_name`, [modelId]);
    if (!result.rows[0]) return reply.code(404).send({ error: "Model not found" });

    // usage_events / usage_rollups keep historical model_id text (no FK to models).
    // buyer_model_access rows cascade-delete with the model.
    return {
      deleted: true,
      model: result.rows[0],
      access_removed: Number(accessCount.rows[0]?.count ?? 0)
    };
  });

  app.post("/admin/models/sync", async (_request, reply) => {
    // Determine the primary (default) upstream id so synced models are pinned to it.
    const upstreamsResult = await query<{ id: string }>(
      `SELECT id FROM upstreams WHERE is_active = true ORDER BY created_at ASC LIMIT 1`
    );
    const primaryUpstreamId = upstreamsResult.rows[0]?.id ?? null;

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

    for (const model of parsed.data.data) {
      if (!isAllowedUpstreamModelId(model.id)) continue;
      // Free-tier gateway: only sync :free models from the default upstream.
      if (!model.id.endsWith(":free")) continue;
      const aliasId = aliasForUpstreamModel(model.id);
      if (!isAllowedPublicModelId(aliasId)) continue;
      const displayName = displayNameForModel(aliasId);
      const result = await query(
        `insert into models (id, upstream_model, display_name, active, upstream_id)
         values ($1, $2, $3, true, $4)
         on conflict (id) do update set
          upstream_model = excluded.upstream_model,
          display_name = excluded.display_name,
          active = true,
          upstream_id = excluded.upstream_id
         returning *`,
        [aliasId, model.id, displayName, primaryUpstreamId]
      );
      synced.push(result.rows[0]);

      // Never auto-grant role-restricted models to every key.
      await reapplyModelAccessFromDb(aliasId);
      const priv = await query<{ restricted: boolean }>(
        `select cardinality(coalesce(access_roles, '{}'::text[])) > 0 as restricted from models where id = $1`,
        [aliasId]
      );
      if (!priv.rows[0]?.restricted) {
        const grantResult = await query(
          `insert into buyer_model_access (api_key_id, model_id)
           select id, $1 from api_keys
           where deleted_at is null
           on conflict do nothing`,
          [aliasId]
        );
        granted += grantResult.rowCount ?? 0;
      }
    }

    // Additive only: never auto-delete models missing from upstream.
    // Manual delete remains available via admin model DELETE.
    return { synced: synced.length, granted, removed: 0, models: synced };
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
        k.daily_reset, k.daily_quota_tokens, k.package_id, k.rate_limit_rpm, k.is_ultra,
        k.access_roles
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

  // --- Set token quota: unlimited (null) or finite cap (e.g. 100M/200M/300M/500M) ---
  app.patch("/admin/keys/:keyId/token-quota", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const body = z
      .object({
        // null = unlimited lifetime token quota
        quota_tokens: z.union([z.number().int().positive(), z.null()])
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid payload. Requires { quota_tokens: number | null }" });
    }

    const existing = await query<{ id: string; quota_tokens: string | null }>(
      `SELECT id, quota_tokens FROM api_keys WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [params.data.keyId]
    );
    if (!existing.rowCount) return reply.code(404).send({ error: "Key not found" });

    // Unlimited: clear token cap + force daily-reset off (daily needs a finite max).
    // Finite: set quota_tokens only; keep used_tokens (may immediately block if already over).
    // expires_at is never touched here.
    const result =
      body.data.quota_tokens === null
        ? await query(
            `UPDATE api_keys
             SET quota_tokens = NULL,
                 daily_reset = false,
                 daily_quota_tokens = NULL
             WHERE id = $1 AND deleted_at IS NULL
             RETURNING id, quota_tokens, daily_reset, daily_quota_tokens, used_tokens, expires_at`,
            [params.data.keyId]
          )
        : await query(
            `UPDATE api_keys
             SET quota_tokens = $1
             WHERE id = $2 AND deleted_at IS NULL
             RETURNING id, quota_tokens, daily_reset, daily_quota_tokens, used_tokens, expires_at`,
            [body.data.quota_tokens, params.data.keyId]
          );

    if (!result.rowCount) return reply.code(404).send({ error: "Key not found" });

    // If daily reset stays ON after setting a finite quota, keep daily_quota_tokens in sync
    // only when it was previously null (e.g. just left unlimited). Do not rewrite an existing daily max.
    if (body.data.quota_tokens !== null) {
      await query(
        `UPDATE api_keys
         SET daily_quota_tokens = quota_tokens
         WHERE id = $1
           AND deleted_at IS NULL
           AND daily_reset = true
           AND daily_quota_tokens IS NULL`,
        [params.data.keyId]
      );
    }

    invalidateApiKeyCache();
    // Re-sync restricted models if key entered/left Ultra (or other role match).
    await syncKeyRestrictedModelAccess(params.data.keyId);
    const fresh = await query(
      `SELECT id, quota_tokens, daily_reset, daily_quota_tokens, used_tokens, expires_at
       FROM api_keys WHERE id = $1 LIMIT 1`,
      [params.data.keyId]
    );
    return {
      ok: true,
      key: fresh.rows[0],
      unlimited: body.data.quota_tokens === null
    };
  });

  // --- Set per-key access roles (dev / supporter / ultra) ---
  app.patch("/admin/keys/:keyId/roles", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const body = z.object({
      roles: z.array(z.enum(MODEL_ACCESS_ROLES))
    }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid payload. Requires { roles: string[] } where each role is one of: dev, supporter, ultra" });
    }

    const roles = normalizeAccessRoles(body.data.roles);

    const result = await query<{ id: string; access_roles: string[] | null }>(
      `UPDATE api_keys SET access_roles = $2::text[] WHERE id = $1 AND deleted_at IS NULL RETURNING id, access_roles`,
      [params.data.keyId, roles]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Key not found" });

    // Sync is_ultra flag: if 'ultra' in roles, set is_ultra = true for backward compat
    if (roles.includes("ultra")) {
      await query(`UPDATE api_keys SET is_ultra = true WHERE id = $1`, [params.data.keyId]);
    } else {
      // If 'ultra' was removed and it was only set via access_roles, clear the flag
      // But keep is_ultra=true if key was created as Ultra package (has ultra quota)
      const ultraCheck = await query<{ quota_tokens: string | null; package_id: string | null }>(
        `SELECT quota_tokens, package_id FROM api_keys WHERE id = $1`,
        [params.data.keyId]
      );
      const k = ultraCheck.rows[0];
      if (k && k.package_id !== "ultra" && k.quota_tokens !== String(ULTRA_QUOTA_TOKENS)) {
        await query(`UPDATE api_keys SET is_ultra = false WHERE id = $1`, [params.data.keyId]);
      }
    }

    invalidateApiKeyCache();
    // Re-sync restricted model grants for this key
    await syncKeyRestrictedModelAccess(params.data.keyId);

    const fresh = await query(
      `SELECT id, access_roles, is_ultra FROM api_keys WHERE id = $1 LIMIT 1`,
      [params.data.keyId]
    );
    return {
      ok: true,
      key: fresh.rows[0],
      roles
    };
  });

  // --- Toggle daily reset for a key (quota resets at 00:00 WIB) ---
  app.patch("/admin/keys/:keyId/daily-reset", async (request, reply) => {
    const params = z.object({ keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid key id" });

    const body = z.object({
      daily_reset: z.boolean()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { daily_reset: boolean }" });

    const existing = await query<{ id: string; quota_tokens: string | null; daily_reset: boolean }>(
      `SELECT id, quota_tokens, daily_reset FROM api_keys WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [params.data.keyId]
    );
    if (!existing.rowCount) return reply.code(404).send({ error: "Key not found" });

    const key = existing.rows[0];
    if (body.data.daily_reset && key.quota_tokens === null) {
      return reply.code(400).send({
        error: "Key has unlimited quota (no max tokens). Set a token quota first before enabling daily reset."
      });
    }

    // ON: use current quota_tokens as daily max and start a fresh day (used_tokens = 0).
    // OFF: clear daily_quota_tokens; keep used_tokens as lifetime counter again.
    const result = await query(
      body.data.daily_reset
        ? `UPDATE api_keys
           SET daily_reset = true,
               daily_quota_tokens = quota_tokens,
               used_tokens = 0
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id, daily_reset, daily_quota_tokens, quota_tokens, used_tokens`
        : `UPDATE api_keys
           SET daily_reset = false,
               daily_quota_tokens = NULL
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id, daily_reset, daily_quota_tokens, quota_tokens, used_tokens`,
      [params.data.keyId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Key not found" });

    invalidateApiKeyCache();
    return { ok: true, key: result.rows[0] };
  });

  // --- Bulk enable/disable daily reset for all keys that have max token ---
  app.patch("/admin/keys/bulk-daily-reset", async (request, reply) => {
    const body = z.object({
      daily_reset: z.boolean()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid payload. Requires { daily_reset: boolean }" });

    let result;
    if (body.data.daily_reset) {
      // Only keys with a finite token quota (skip Super Admin / unlimited)
      // Fresh day: zero used_tokens so they don't start already near limit
      result = await query(
        `UPDATE api_keys
         SET daily_reset = true,
             daily_quota_tokens = quota_tokens,
             used_tokens = 0
         WHERE deleted_at IS NULL
           AND is_hidden = false
           AND quota_tokens IS NOT NULL`
      );
    } else {
      result = await query(
        `UPDATE api_keys
         SET daily_reset = false,
             daily_quota_tokens = NULL
         WHERE deleted_at IS NULL
           AND is_hidden = false
           AND daily_reset = true`
      );
    }

    invalidateApiKeyCache();
    return {
      ok: true,
      updated: result.rowCount || 0,
      daily_reset: body.data.daily_reset,
      message: body.data.daily_reset
        ? "Daily reset enabled for all keys with max token (resets 00:00 WIB)"
        : "Daily reset disabled for all keys"
    };
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
        b.name as buyer_name, k.key_prefix, k.quota_tokens, k.is_ultra
       from usage_events ue
       left join buyers b on b.id = ue.buyer_id
       left join api_keys k on k.id = ue.api_key_id
       order by ue.created_at desc
       limit 250`
    );
    return { events: result.rows };
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
        k.quota_tokens,
        k.is_ultra,
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
       group by k.id, k.key_prefix, k.quota_tokens, k.is_ultra, b.name, b.email
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
        k.quota_tokens,
        k.is_ultra,
        COUNT(ue.id)::int as total_requests,
        COALESCE(SUM(ue.total_tokens), 0)::bigint as total_tokens,
        COALESCE(SUM(ue.prompt_tokens), 0)::bigint as prompt_tokens,
        COALESCE(SUM(ue.completion_tokens), 0)::bigint as completion_tokens,
        MAX(ue.created_at) as last_request_at
      FROM usage_events ue
      JOIN api_keys k ON k.id = ue.api_key_id
      JOIN buyers b ON b.id = k.buyer_id
      WHERE k.is_hidden = false
      GROUP BY b.id, b.name, b.email, k.id, k.label, k.key_prefix, k.expires_at, k.created_at, k.quota_tokens, k.is_ultra
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
    const primaryUpstreamId = (await query<{ id: string }>(`SELECT id FROM upstreams WHERE is_active = true ORDER BY created_at ASC LIMIT 1`)).rows[0]?.id ?? null;
    for (const model of parsedModels.data.data) {
    if (!isAllowedUpstreamModelId(model.id)) continue;
    // Free-tier gateway: only sync :free models from the default upstream.
    if (!model.id.endsWith(":free")) continue;
    const aliasId = aliasForUpstreamModel(model.id);
      if (!isAllowedPublicModelId(aliasId)) continue;
      const displayName = displayNameForModel(aliasId);
      await query(
        `insert into models (id, upstream_model, display_name, active, upstream_id)
         values ($1, $2, $3, true, $4)
         on conflict (id) do update set
          upstream_model = excluded.upstream_model,
          display_name = excluded.display_name,
          active = true,
          upstream_id = excluded.upstream_id`,
        [aliasId, model.id, displayName, primaryUpstreamId]
      );
      const priv = await query<{ restricted: boolean }>(
        `select cardinality(coalesce(access_roles, '{}'::text[])) > 0 as restricted from models where id = $1`,
        [aliasId]
      );
      if (priv.rows[0]?.restricted) {
        await reapplyModelAccessFromDb(aliasId);
      } else {
        await query(
          `insert into buyer_model_access (api_key_id, model_id)
           select id, $1 from api_keys
           where deleted_at is null
           on conflict do nothing`,
          [aliasId]
        );
      }
      synced++;
    }

    // Additive only: never auto-delete models missing from upstream.
    return { saved: true, synced, removed: 0, message: `Upstream updated and ${synced} models synced, 0 removed` };
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
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload" });

    const result = await query<{ id: string }>(
      `INSERT INTO upstreams (name, base_url, api_key, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [parsed.data.name, parsed.data.base_url, parsed.data.api_key, parsed.data.is_active]
    );
    await query(
      `INSERT INTO upstream_api_keys (upstream_id, label, api_key, is_active)
       VALUES ($1, 'primary', $2, true)
       ON CONFLICT DO NOTHING`,
      [result.rows[0].id, parsed.data.api_key]
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
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload" });

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (parsed.data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(parsed.data.name); }
    if (parsed.data.base_url !== undefined) { updates.push(`base_url = $${idx++}`); values.push(parsed.data.base_url); }
    if (parsed.data.api_key !== undefined) { updates.push(`api_key = $${idx++}`); values.push(parsed.data.api_key); }
    if (parsed.data.is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(parsed.data.is_active); }

    if (updates.length === 0) return reply.code(400).send({ error: "No fields to update" });

    updates.push(`updated_at = NOW()`);
    values.push(params.data.id);

    await query(
      `UPDATE upstreams SET ${updates.join(", ")} WHERE id = $${idx}`,
      values
    );
    if (parsed.data.api_key !== undefined) {
      // Keep multi-key table in sync: if no keys yet, insert primary; else update first active or insert new primary
      const existing = await query<{ id: string }>(
        `SELECT id FROM upstream_api_keys WHERE upstream_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [params.data.id]
      );
      if (existing.rows[0]) {
        await query(
          `UPDATE upstream_api_keys SET api_key = $1, updated_at = NOW() WHERE id = $2`,
          [parsed.data.api_key, existing.rows[0].id]
        );
      } else {
        await query(
          `INSERT INTO upstream_api_keys (upstream_id, label, api_key, is_active)
           VALUES ($1, 'primary', $2, true)`,
          [params.data.id, parsed.data.api_key]
        );
      }
    }
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

  // --- Upstream multi API keys (round-robin within one upstream) ---
  async function syncUpstreamPrimaryKey(upstreamId: string) {
    const active = await query<{ api_key: string }>(
      `SELECT api_key FROM upstream_api_keys
       WHERE upstream_id = $1 AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [upstreamId]
    );
    const anyKey = active.rows[0]?.api_key
      ?? (await query<{ api_key: string }>(
        `SELECT api_key FROM upstream_api_keys WHERE upstream_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [upstreamId]
      )).rows[0]?.api_key
      ?? "";
    if (anyKey) {
      await query(
        `UPDATE upstreams SET api_key = $1, updated_at = NOW() WHERE id = $2`,
        [anyKey, upstreamId]
      );
    }
  }

  app.get("/admin/upstreams/:id/keys", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid upstream ID" });
    const result = await query<{
      id: string;
      label: string;
      api_key: string;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT id, label, api_key, is_active, created_at
       FROM upstream_api_keys
       WHERE upstream_id = $1
       ORDER BY created_at ASC`,
      [params.data.id]
    );
    return {
      keys: result.rows.map((r) => ({
        id: r.id,
        label: r.label,
        apiKey: r.api_key,
        isActive: r.is_active,
        createdAt: r.created_at,
        masked: r.api_key.length > 10
          ? r.api_key.slice(0, 6) + "..." + r.api_key.slice(-4)
          : r.api_key,
      })),
    };
  });

  app.post("/admin/upstreams/:id/keys", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid upstream ID" });
    const parsed = z.object({
      api_key: z.string().min(1),
      label: z.string().max(255).optional().default(""),
      is_active: z.boolean().optional().default(true),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload. Requires api_key" });

    const exists = await query<{ id: string }>(`SELECT id FROM upstreams WHERE id = $1`, [params.data.id]);
    if (!exists.rows[0]) return reply.code(404).send({ error: "Upstream not found" });

    try {
      const result = await query<{ id: string }>(
        `INSERT INTO upstream_api_keys (upstream_id, label, api_key, is_active)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [params.data.id, parsed.data.label || "", parsed.data.api_key, parsed.data.is_active]
      );
      await syncUpstreamPrimaryKey(params.data.id);
      clearUpstreamCache();
      return { id: result.rows[0].id, message: "API key added" };
    } catch (err: any) {
      if (String(err?.message || "").includes("uq_upstream_api_keys_upstream_key")) {
        return reply.code(409).send({ error: "API key already exists for this upstream" });
      }
      throw err;
    }
  });

  app.put("/admin/upstreams/:id/keys/:keyId", async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid ids" });
    const parsed = z.object({
      api_key: z.string().min(1).optional(),
      label: z.string().max(255).optional(),
      is_active: z.boolean().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload" });

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (parsed.data.api_key !== undefined) { updates.push(`api_key = $${idx++}`); values.push(parsed.data.api_key); }
    if (parsed.data.label !== undefined) { updates.push(`label = $${idx++}`); values.push(parsed.data.label); }
    if (parsed.data.is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(parsed.data.is_active); }
    if (updates.length === 0) return reply.code(400).send({ error: "No fields to update" });
    updates.push(`updated_at = NOW()`);
    values.push(params.data.keyId, params.data.id);
    const result = await query(
      `UPDATE upstream_api_keys SET ${updates.join(", ")}
       WHERE id = $${idx} AND upstream_id = $${idx + 1}
       RETURNING id`,
      values
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: "Key not found" });
    await syncUpstreamPrimaryKey(params.data.id);
    clearUpstreamCache();
    return { ok: true, message: "API key updated" };
  });

  app.patch("/admin/upstreams/:id/keys/:keyId/toggle", async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid ids" });
    const result = await query(
      `UPDATE upstream_api_keys
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 AND upstream_id = $2
       RETURNING id, is_active`,
      [params.data.keyId, params.data.id]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: "Key not found" });
    await syncUpstreamPrimaryKey(params.data.id);
    clearUpstreamCache();
    return { ok: true, is_active: result.rows[0].is_active };
  });

  app.delete("/admin/upstreams/:id/keys/:keyId", async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid ids" });

    const count = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM upstream_api_keys WHERE upstream_id = $1`,
      [params.data.id]
    );
    if (Number(count.rows[0]?.count || 0) <= 1) {
      return reply.code(400).send({ error: "Cannot delete the last API key. Add another key first." });
    }

    const result = await query(
      `DELETE FROM upstream_api_keys WHERE id = $1 AND upstream_id = $2 RETURNING id`,
      [params.data.keyId, params.data.id]
    );
    if (result.rowCount === 0) return reply.code(404).send({ error: "Key not found" });
    await syncUpstreamPrimaryKey(params.data.id);
    clearUpstreamCache();
    return { ok: true, message: "API key deleted" };
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
    for (const model of parsedModels.data.data) {
      if (!isAllowedUpstreamModelId(model.id)) continue;
      const aliasId = aliasForUpstreamModel(model.id);
      if (!isAllowedPublicModelId(aliasId)) continue;
      const displayName = displayNameForModel(aliasId);
      await query(
        `INSERT INTO models (id, upstream_model, display_name, active, upstream_id)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (id) DO UPDATE SET
          upstream_model = excluded.upstream_model,
          display_name = excluded.display_name,
          active = true,
          upstream_id = excluded.upstream_id`,
        [aliasId, model.id, displayName, params.data.id]
      );
      // Preserve role-restricted grants if the row already has access_roles.
      const priv = await query<{ restricted: boolean }>(
        `select cardinality(coalesce(access_roles, '{}'::text[])) > 0 as restricted from models where id = $1`,
        [aliasId]
      );
      if (priv.rows[0]?.restricted) {
        await reapplyModelAccessFromDb(aliasId);
      } else {
        await query(
          `INSERT INTO buyer_model_access (api_key_id, model_id)
           SELECT id, $1 FROM api_keys WHERE deleted_at IS NULL ON CONFLICT DO NOTHING`,
          [aliasId]
        );
      }
      synced++;
    }

    // Additive only: never auto-delete models missing from this upstream.
    // Manual delete remains available via admin model DELETE.
    return { synced, removed: 0, message: `Synced ${synced} models from upstream, 0 removed` };
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

  await query(`
    CREATE TABLE IF NOT EXISTS upstream_api_keys (
      id uuid primary key default gen_random_uuid(),
      upstream_id uuid not null references upstreams(id) on delete cascade,
      label varchar(255) not null default '',
      api_key text not null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_upstream_api_keys_upstream ON upstream_api_keys(upstream_id)`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_upstream_api_keys_upstream_key
    ON upstream_api_keys(upstream_id, api_key)
  `);
  // Migrate legacy single-key column into multi-key table
  await query(`
    INSERT INTO upstream_api_keys (upstream_id, label, api_key, is_active)
    SELECT u.id, 'primary', u.api_key, true
    FROM upstreams u
    WHERE u.api_key is not null and length(trim(u.api_key)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM upstream_api_keys k
        WHERE k.upstream_id = u.id AND k.api_key = u.api_key
      )
  `);
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
