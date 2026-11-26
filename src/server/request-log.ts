import { query } from "./db.js";

export const REQUEST_LOG_PROMPT_MAX = 1024;
export const REQUEST_LOG_RESPONSE_MAX = 1024;
export const REQUEST_LOG_RETENTION_DAYS = 7;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export type PromptSnapshot = {
  text: string | null;
  truncated: boolean;
};

export type ResponseSnapshot = {
  text: string | null;
  truncated: boolean;
};

export function extractLastUserPrompt(body: unknown): PromptSnapshot {
  if (!body || typeof body !== "object") return { text: null, truncated: false };
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { text: null, truncated: false };
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const role = String((msg as { role?: unknown }).role ?? "").toLowerCase();
    if (role !== "user") continue;
    const raw = flattenMessageContent((msg as { content?: unknown }).content);
    const cleaned = sanitizePrompt(raw);
    if (!cleaned) return { text: null, truncated: false };
    if (cleaned.length <= REQUEST_LOG_PROMPT_MAX) {
      return { text: cleaned, truncated: false };
    }
    return { text: cleaned.slice(0, REQUEST_LOG_PROMPT_MAX), truncated: true };
  }

  return { text: null, truncated: false };
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
    return parts.join("\n");
  }
  if (content && typeof content === "object") {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

export function extractNonStreamResponse(body: unknown): ResponseSnapshot {
  if (!body || typeof body !== "object") return { text: null, truncated: false };
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { text: null, truncated: false };
  }
  const first = choices[0];
  if (!first || typeof first !== "object") return { text: null, truncated: false };

  let raw = "";
  if ("message" in first && first.message && typeof first.message === "object") {
    raw = flattenMessageContent((first.message as { content?: unknown }).content);
  } else if ("text" in first && typeof (first as { text?: unknown }).text === "string") {
    raw = (first as { text: string }).text;
  }

  const cleaned = sanitizePrompt(raw);
  if (!cleaned) return { text: null, truncated: false };
  if (cleaned.length <= REQUEST_LOG_RESPONSE_MAX) {
    return { text: cleaned, truncated: false };
  }
  return { text: cleaned.slice(0, REQUEST_LOG_RESPONSE_MAX), truncated: true };
}

export function sanitizePrompt(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) continue;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    out += text[i]!;
  }
  return out.trim();
}

export async function pruneExpiredRequestLogs(): Promise<number> {
  const result = await query(
    `DELETE FROM request_logs
     WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [REQUEST_LOG_RETENTION_DAYS]
  );
  return result.rowCount ?? 0;
}

export function startRequestLogRetentionCron() {
  const run = async () => {
    try {
      const deleted = await pruneExpiredRequestLogs();
      if (deleted > 0) {
        console.log(`[request-log] Pruned ${deleted} row(s) older than ${REQUEST_LOG_RETENTION_DAYS}d`);
      }
    } catch (err) {
      console.error("[request-log] Prune failed:", err);
    }
  };
  run();
  setInterval(run, PRUNE_INTERVAL_MS);
  console.log(`[request-log] Retention cron started. Keeps ${REQUEST_LOG_RETENTION_DAYS} days, checks hourly.`);
}
