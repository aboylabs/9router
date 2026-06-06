import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { chatRateLimiter } from "./rate-limiter.js";
import { bearerToken } from "./security.js";
import { apiKeyIsUsable, findApiKey, modelForKey, publicModelsForKey, recordUsage } from "./repositories.js";
import { callUpstream, streamUpstream } from "./upstream.js";
import { costEstimate, estimateUsage, usageFromResponse } from "./usage.js";

const chatCompletionSchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().optional()
}).passthrough();

export const TOKEN_MULTIPLIER = 2;

export type MeteredUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
};

export function billSuccessfulUsage(usage: MeteredUsage): MeteredUsage {
  const promptTokens = usage.promptTokens * TOKEN_MULTIPLIER;
  const completionTokens = usage.completionTokens * TOKEN_MULTIPLIER;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: usage.estimated
  };
}

export function zeroFailedUsage(): MeteredUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false };
}

type BuyerFacingUpstreamFailure = {
  statusCode: number;
  body: {
    error: {
      message: string;
      code: string;
    };
  };
};

export function buyerFacingUpstreamFailure(errorCode?: string): BuyerFacingUpstreamFailure {
  if (errorCode === "upstream_timeout") {
    return {
      statusCode: 504,
      body: { error: { message: "Upstream request timed out", code: errorCode } }
    };
  }

  if (errorCode === "upstream_connection_error") {
    return {
      statusCode: 502,
      body: { error: { message: "Upstream connection failed", code: errorCode } }
    };
  }

  if (errorCode === "upstream_fetch_error") {
    return {
      statusCode: 502,
      body: { error: { message: "Upstream request failed", code: errorCode } }
    };
  }

  return {
    statusCode: 502,
    body: { error: { message: "Service temporarily unavailable", code: "upstream_error" } }
  };
}

export async function registerProxyRoutes(app: FastifyInstance) {
  app.get("/v1/models", async (request, reply) => {
    const apiKey = await requireBuyerKey(request.headers.authorization, reply);
    if (!apiKey) return;
    if (apiKey.is_hidden) request.log.level = "silent";

    const models = await publicModelsForKey(apiKey.id);
    return {
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: model.created,
        owned_by: model.owned_by
      }))
    };
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    const started = Date.now();
    const apiKey = await requireBuyerKey(request.headers.authorization, reply);
    if (!apiKey) return;
    if (apiKey.is_hidden) request.log.level = "silent";

    const effectiveRpm = apiKey.rate_limit_rpm ?? (apiKey.is_hidden ? config.HIDDEN_KEY_CHAT_RPM : config.BUYER_CHAT_RPM);
    const rateLimit = chatRateLimiter.check(apiKey.id, effectiveRpm);
    if (!rateLimit.allowed) {
      reply.header("Retry-After", String(rateLimit.retryAfterSeconds));
      return reply.code(429).send({
        error: {
          message: `Rate limit exceeded: maximum ${effectiveRpm} requests per minute for this API key`,
          code: "rate_limit_exceeded"
        }
      });
    }

    const parsed = chatCompletionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: "Invalid chat completion request", code: "invalid_request" } });
    }

    const access = await modelForKey(apiKey.id, parsed.data.model);
    if (!access) {
      return reply.code(403).send({
        error: { message: "Model is not available for this API key", code: "model_not_allowed" }
      });
    }

    const upstreamBody = {
      ...parsed.data,
      model: access.upstream_model,
      stream: parsed.data.stream === true
    };
    const agentId = String(request.headers["x-agent-id"] ?? "default");

    if (parsed.data.stream) {
      const streamBody = {
        ...upstreamBody,
        stream_options: {
          ...(typeof parsed.data.stream_options === "object" && parsed.data.stream_options !== null
            ? parsed.data.stream_options
            : {}),
          include_usage: true
        }
      };
      const upstream = await streamUpstream("/chat/completions", streamBody);
      const upstreamErrorCode = upstream.headers.get("x-9router-error-code") ?? "upstream_error";

      if (upstream.status >= 400) {
        const upstreamBody = await responseBody(upstream);
        const buyerFailure = buyerFacingUpstreamFailure(upstreamErrorCode);
        if (!apiKey.is_hidden) {
          request.log.warn(
            { upstreamStatusCode: upstream.status, upstreamErrorCode, upstreamModel: access.upstream_model, upstreamBody },
            "Upstream chat completion failed"
          );
        }
        const usage = zeroFailedUsage();
        if (!apiKey.is_hidden) {
          recordUsage({
            buyerId: apiKey.buyer_id,
            apiKeyId: apiKey.id,
            agentId,
            endpoint: "/v1/chat/completions",
            modelId: access.id,
            upstreamModel: access.upstream_model,
            statusCode: upstream.status,
            success: false,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            estimated: usage.estimated,
            costEstimate: 0,
            latencyMs: Date.now() - started,
            errorCode: upstreamErrorCode
          }).catch(() => {});
        }

        return reply.code(buyerFailure.statusCode).send(buyerFailure.body);
      }

      reply.hijack();

      const headers: Record<string, string> = {};
      for (const [key, value] of upstream.headers.entries()) {
        if (["content-type", "cache-control", "connection", "x-request-id"].includes(key.toLowerCase())) {
          headers[key] = value;
        }
      }
      headers["x-9router-streaming"] = "true";
      reply.raw.writeHead(upstream.status, headers);

      const reader = upstream.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let upstreamUsage: MeteredUsage | null = null;

      function parseSseChunk(text: string) {
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as {
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              } | null;
            };
            if (parsed.usage) {
              upstreamUsage = {
                promptTokens: Number(parsed.usage.prompt_tokens ?? 0),
                completionTokens: Number(parsed.usage.completion_tokens ?? 0),
                totalTokens: Number(parsed.usage.total_tokens ?? 0),
                estimated: false
              };
            }
          } catch {
            // partial/non-JSON SSE payloads
          }
        }
      }

      try {
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              parseSseChunk(decoder.decode(value, { stream: true }));
              reply.raw.write(Buffer.from(value));
            }
          }
          parseSseChunk(decoder.decode());
        }
      } catch {
        // client disconnected or upstream error
      } finally {
        reply.raw.end();
        let usage: MeteredUsage;
        if (upstreamUsage) {
          usage = upstreamUsage;
        } else {
          const est = estimateUsage(parsed.data, null);
          usage = {
            promptTokens: Math.min(est.promptTokens, 50000),
            completionTokens: 0,
            totalTokens: Math.min(est.promptTokens, 50000),
            estimated: true
          };
        }
        const billedUsage = billSuccessfulUsage(usage);
        const estimatedCost = costEstimate({
          promptTokens: billedUsage.promptTokens,
          completionTokens: billedUsage.completionTokens,
          inputCostPerMillion: access.input_cost_per_million,
          outputCostPerMillion: access.output_cost_per_million
        });
        if (!apiKey.is_hidden) {
          recordUsage({
            buyerId: apiKey.buyer_id,
            apiKeyId: apiKey.id,
            agentId,
            endpoint: "/v1/chat/completions",
            modelId: access.id,
            upstreamModel: access.upstream_model,
            statusCode: upstream.status,
            success: upstream.status >= 200 && upstream.status < 400,
            promptTokens: billedUsage.promptTokens,
            completionTokens: billedUsage.completionTokens,
            totalTokens: billedUsage.totalTokens,
            estimated: billedUsage.estimated,
            costEstimate: estimatedCost,
            latencyMs: Date.now() - started,
            errorCode: upstream.status >= 400 ? "upstream_error" : null
          }).catch(() => {});
        }
      }

      return;
    }

    const upstream = await callUpstream("/chat/completions", upstreamBody);
    const success = upstream.statusCode >= 200 && upstream.statusCode < 400;
    let usageForLog = zeroFailedUsage();

    if (success) {
      const usage = usageFromResponse(upstream.body) ?? estimateUsage(parsed.data, upstream.body);
      usageForLog = billSuccessfulUsage(usage);
    } else if (!apiKey.is_hidden) {
      request.log.warn(
        {
          upstreamStatusCode: upstream.statusCode,
          upstreamErrorCode: upstream.errorCode ?? "upstream_error",
          upstreamModel: access.upstream_model,
          upstreamBody: upstream.body
        },
        "Upstream chat completion failed"
      );
    }

    const estimatedCost = costEstimate({
      promptTokens: usageForLog.promptTokens,
      completionTokens: usageForLog.completionTokens,
      inputCostPerMillion: access.input_cost_per_million,
      outputCostPerMillion: access.output_cost_per_million
    });

    if (!apiKey.is_hidden) {
      recordUsage({
        buyerId: apiKey.buyer_id,
        apiKeyId: apiKey.id,
        agentId,
        endpoint: "/v1/chat/completions",
        modelId: access.id,
        upstreamModel: access.upstream_model,
        statusCode: upstream.statusCode,
        success,
        promptTokens: usageForLog.promptTokens,
        completionTokens: usageForLog.completionTokens,
        totalTokens: usageForLog.totalTokens,
        estimated: usageForLog.estimated,
        costEstimate: estimatedCost,
        latencyMs: Date.now() - started,
        errorCode: success ? null : upstream.errorCode ?? "upstream_error"
      }).catch(() => {});
    }

    if (!success) {
      const buyerFailure = buyerFacingUpstreamFailure(upstream.errorCode);
      return reply.code(buyerFailure.statusCode).send(buyerFailure.body);
    }

    return reply.code(upstream.statusCode).send(upstream.body);
  });
}

async function responseBody(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function requireBuyerKey(authorization: string | undefined, reply: FastifyReply) {
  const token = bearerToken(authorization);
  if (!token) {
    reply.code(401).send({ error: { message: "Bearer API key required", code: "missing_api_key" } });
    return null;
  }

  const apiKey = await findApiKey(token);
  if (!apiKey) {
    reply.code(401).send({ error: { message: "Invalid API key", code: "invalid_api_key" } });
    return null;
  }

  const usable = apiKeyIsUsable(apiKey);
  if (!usable.ok) {
    reply.code(403).send({ error: { message: usable.message, code: usable.code } });
    return null;
  }

  return apiKey;
}
