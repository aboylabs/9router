import type { PoolClient } from "pg";
import { query } from "./db.js";
import { isBrandedModelId } from "./model-alias.js";
import { apiKeyPrefix, hashApiKey } from "./security.js";

export type ApiKeyRecord = {
  id: string;
  buyer_id: string | null;
  label: string;
  key_prefix: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  deleted_at: Date | null;
  quota_tokens: string | null;
  quota_requests: string | null;
  used_tokens: string;
  used_requests: string;
  daily_reset: boolean;
  daily_quota_tokens: string | null;
  package_id: string | null;
  is_hidden: boolean;
  rate_limit_rpm: number | null;
  is_vip: boolean;
};

const apiKeyCache = new Map<string, { record: ApiKeyRecord; expires: number }>();
const API_KEY_CACHE_TTL_MS = 30_000;

export async function findApiKey(apiKey: string) {
  const keyHash = hashApiKey(apiKey);
  const cached = apiKeyCache.get(keyHash);
  if (cached && cached.expires > Date.now()) {
    return cached.record;
  }
  const result = await query<ApiKeyRecord>(
    `select * from api_keys where key_hash = $1 and deleted_at is null limit 1`,
    [keyHash]
  );
  const record = result.rows[0] ?? null;
  if (record) {
    apiKeyCache.set(keyHash, { record, expires: Date.now() + API_KEY_CACHE_TTL_MS });
  } else {
    apiKeyCache.delete(keyHash);
  }
  return record;
}

export function invalidateApiKeyCache(keyHash?: string) {
  if (keyHash) {
    apiKeyCache.delete(keyHash);
  } else {
    apiKeyCache.clear();
  }
}

export function checkTokenQuota(record: ApiKeyRecord) {
  // Daily reset keys: check used_tokens against daily_quota_tokens
  if (record.daily_reset && record.daily_quota_tokens !== null) {
    if (Number(record.used_tokens) >= Number(record.daily_quota_tokens)) {
      return {
        ok: false as const,
        code: "daily_quota_exceeded",
        message: "Daily token quota exceeded. Resets at 00:00 WIB."
      };
    }
  } else if (record.quota_tokens !== null && Number(record.used_tokens) >= Number(record.quota_tokens)) {
    return { ok: false as const, code: "token_quota_exceeded", message: "Token quota exceeded" };
  }
  return { ok: true as const };
}

export function apiKeyIsUsable(record: ApiKeyRecord, opts?: { skipTokenQuota?: boolean }) {
  if (record.is_hidden) return { ok: true as const };
  if (record.deleted_at) return { ok: false, code: "key_deleted", message: "API key has been deleted" };
  if (record.revoked_at) return { ok: false, code: "key_paused", message: "API key is paused" };
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: "key_expired", message: "API key has expired" };
  }
  // Request quota (if set) applies to all keys / all models
  if (record.quota_requests !== null && Number(record.used_requests) >= Number(record.quota_requests)) {
    return { ok: false, code: "request_quota_exceeded", message: "Request quota exceeded" };
  }
  if (!opts?.skipTokenQuota) {
    const tokenQuota = checkTokenQuota(record);
    if (!tokenQuota.ok) return tokenQuota;
  }
  return { ok: true as const };
}

export function shouldRecordUsage(record: ApiKeyRecord) {
  return !record.is_hidden;
}

export async function modelForKey(apiKeyId: string, requestedModel: string) {
  const result = await query<{
    id: string;
    upstream_model: string;
    upstream_id: string | null;
    display_name: string;
    input_cost_per_million: string | null;
    output_cost_per_million: string | null;
    quota_exempt: boolean;
  }>(
    `select m.id, m.upstream_model, m.upstream_id, m.display_name, m.input_cost_per_million, m.output_cost_per_million,
            coalesce(m.quota_exempt, false) as quota_exempt
     from models m
     join buyer_model_access bma on bma.model_id = m.id
     where bma.api_key_id = $1 and m.id = $2 and m.active = true
     limit 1`,
    [apiKeyId, requestedModel]
  );
  return result.rows[0] ?? null;
}

export async function publicModelsForKey(apiKeyId: string) {
  const result = await query<{ id: string; created: number; owned_by: string }>(
    `select m.id, extract(epoch from m.created_at)::integer as created, 'routers9' as owned_by
     from models m
     join buyer_model_access bma on bma.model_id = m.id
     where bma.api_key_id = $1 and m.active = true and (m.id like 'routers9/%' or m.id like 'brand/%')
     order by m.display_name asc`,
    [apiKeyId]
  );
  return result.rows.filter((model) => isBrandedModelId(model.id));
}

export async function createApiKeyRecord(params: {
  buyerId: string;
  label: string;
  apiKey: string;
  expiresAt?: string | null;
  quotaTokens?: number | null;
  quotaRequests?: number | null;
  modelIds: string[];
  dailyReset?: boolean;
  dailyQuotaTokens?: number | null;
  packageId?: string | null;
  rateLimitRpm?: number | null;
  isUltra?: boolean;
  accessRoles?: string[];
}) {
  const client = await queryClient();
  try {
    await client.query("begin");
    const created = await client.query<{ id: string; key_prefix: string }>(
      `insert into api_keys (buyer_id, label, key_prefix, key_hash, key_plain, expires_at, quota_tokens, quota_requests, daily_reset, daily_quota_tokens, package_id, rate_limit_rpm, is_ultra, access_roles)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::text[])
       returning id, key_prefix`,
      [
        params.buyerId,
        params.label,
        apiKeyPrefix(params.apiKey),
        hashApiKey(params.apiKey),
        params.apiKey,
        params.expiresAt ?? null,
        params.quotaTokens ?? null,
        params.quotaRequests ?? null,
        params.dailyReset ?? false,
        params.dailyQuotaTokens ?? null,
        params.packageId ?? null,
        params.rateLimitRpm ?? null,
        params.isUltra ?? false,
        params.accessRoles ?? []
      ]
    );

    for (const modelId of params.modelIds) {
      await client.query(
        `insert into buyer_model_access (api_key_id, model_id) values ($1, $2)
         on conflict do nothing`,
        [created.rows[0].id, modelId]
      );
    }
    await client.query("commit");
    return created.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createBuyerWithApiKeyRecord(params: {
  name: string;
  email?: string | null;
  notes?: string | null;
  keyLabel: string;
  apiKey: string;
  expiresAt?: string | null;
  quotaTokens?: number | null;
  quotaRequests?: number | null;
  modelIds: string[];
  dailyReset?: boolean;
  dailyQuotaTokens?: number | null;
  packageId?: string | null;
  rateLimitRpm?: number | null;
}) {
  const client = await queryClient();
  try {
    await client.query("begin");

    const buyer = await client.query(
      `insert into buyers (name, email, notes) values ($1, $2, $3) returning *`,
      [params.name, params.email ?? null, params.notes ?? null]
    );

    const key = await client.query<{ id: string; key_prefix: string }>(
      `insert into api_keys (buyer_id, label, key_prefix, key_hash, key_plain, expires_at, quota_tokens, quota_requests, daily_reset, daily_quota_tokens, package_id, rate_limit_rpm)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, key_prefix`,
      [
        buyer.rows[0].id,
        params.keyLabel,
        apiKeyPrefix(params.apiKey),
        hashApiKey(params.apiKey),
        params.apiKey,
        params.expiresAt ?? null,
        params.quotaTokens ?? null,
        params.quotaRequests ?? null,
        params.dailyReset ?? false,
        params.dailyQuotaTokens ?? null,
        params.packageId ?? null,
        params.rateLimitRpm ?? null
      ]
    );

    for (const modelId of params.modelIds) {
      await client.query(
        `insert into buyer_model_access (api_key_id, model_id) values ($1, $2)
         on conflict do nothing`,
        [key.rows[0].id, modelId]
      );
    }

    await client.query("commit");
    return { buyer: buyer.rows[0], key: key.rows[0] };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordUsage(params: {
  buyerId?: string | null;
  apiKeyId?: string | null;
  agentId: string;
  endpoint: string;
  modelId?: string | null;
  upstreamModel?: string | null;
  statusCode: number;
  success: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  costEstimate: number;
  latencyMs: number;
  errorCode?: string | null;
  ipAddress?: string | null;
  /** Last user message only (already truncated). Logged outside the billing transaction. */
  userPrompt?: string | null;
  promptTruncated?: boolean;
  /** AI response message snippet (already truncated). Logged outside the billing transaction. */
  aiResponse?: string | null;
  responseTruncated?: boolean;
  /** When false, usage_events/rollups still log tokens but api_keys.used_tokens is not increased (quota-exempt models). Default true. */
  countTowardTokenQuota?: boolean;
}) {
  const client = await queryClient();
  const countTowardTokenQuota = params.countTowardTokenQuota !== false;
  try {
    await client.query("begin");
    await client.query(
      `insert into usage_events
       (buyer_id, api_key_id, agent_id, endpoint, model_id, upstream_model, status_code, success,
        prompt_tokens, completion_tokens, total_tokens, estimated, cost_estimate, latency_ms, error_code, ip_address)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        params.buyerId ?? null,
        params.apiKeyId ?? null,
        params.agentId,
        params.endpoint,
        params.modelId ?? null,
        params.upstreamModel ?? null,
        params.statusCode,
        params.success,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.estimated,
        params.costEstimate,
        params.latencyMs,
        params.errorCode ?? null,
        params.ipAddress ?? null
      ]
    );

    if (params.apiKeyId) {
      // used_requests always increments (request-quota still applies).
      // used_tokens only when the model is not quota-exempt.
      await client.query(
        `update api_keys
         set used_tokens = used_tokens + $1, used_requests = used_requests + 1
         where id = $2`,
        [countTowardTokenQuota ? params.totalTokens : 0, params.apiKeyId]
      );
    }

    await client.query(
      `insert into usage_rollups
       (day, buyer_id, api_key_id, model_id, agent_id, request_count, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
       values (current_date, $1, $2, $3, $4, 1, $5, $6, $7, $8)
       on conflict (day, buyer_id, api_key_id, model_id, agent_id)
       do update set
        request_count = usage_rollups.request_count + 1,
        prompt_tokens = usage_rollups.prompt_tokens + excluded.prompt_tokens,
        completion_tokens = usage_rollups.completion_tokens + excluded.completion_tokens,
        total_tokens = usage_rollups.total_tokens + excluded.total_tokens,
        cost_estimate = usage_rollups.cost_estimate + excluded.cost_estimate`,
      [
        params.buyerId ?? null,
        params.apiKeyId ?? null,
        params.modelId ?? null,
        params.agentId,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.costEstimate
      ]
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  try {
    await query(
      `INSERT INTO request_logs
       (buyer_id, api_key_id, model_id, status_code, success,
        prompt_tokens, completion_tokens, total_tokens, latency_ms, error_code,
        ip_address, user_prompt, prompt_truncated, ai_response, response_truncated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        params.buyerId ?? null,
        params.apiKeyId ?? null,
        params.modelId ?? null,
        params.statusCode,
        params.success,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.latencyMs,
        params.errorCode ?? null,
        params.ipAddress ?? null,
        params.userPrompt ?? null,
        params.promptTruncated === true,
        params.aiResponse ?? null,
        params.responseTruncated === true
      ]
    );
  } catch (error) {
    console.error("[request-log] Failed to insert request_logs row:", error);
  }
}

async function queryClient(): Promise<PoolClient> {
  const { pool } = await import("./db.js");
  return pool.connect();
}
