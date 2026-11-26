import { z } from "zod";

// z.coerce.boolean treats any non-empty string as true ("false" => true). Parse explicitly.
const boolFromEnv = z.preprocess((val) => {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const v = val.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off", ""].includes(v)) return false;
  }
  return val;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_BRAND_NAME: z.string().default("9router"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/9router"),
  JWT_SECRET: z.string().min(24).default("9router-change-this-long-random-secret"),
  COOKIE_SECURE: boolFromEnv.default(false),
  // Legacy fallback only (used when upstreams table empty). Keep in sync with live primary.
  UPSTREAM_BASE_URL: z.string().url().default("http://localhost:8000/v1"),
  UPSTREAM_API_KEY: z.string().min(1).default("sk-replace-with-upstream-key"),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  UPSTREAM_STREAM_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  BUYER_CHAT_RPM: z.coerce.number().int().positive().default(30),
  HIDDEN_KEY_CHAT_RPM: z.coerce.number().int().positive().default(300),
  // Empty allowed: means "no hidden keys to seed" (production often disables them).
  HIDDEN_KEY_VALUES: z.string().default("hidden-key-1,hidden-key-2"),
  ADMIN_API_KEY: z.string().min(16).optional(),
  INITIAL_ADMIN_EMAIL: z.string().min(1).default("9router"),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).default("ChangeMeNow!2024"),
  API_KEY_PREFIX: z.string().default("9r"),
  CLIENT_DIR: z.string().optional()
});

export const config = envSchema.parse(process.env);

export const isProduction = config.NODE_ENV === "production";
