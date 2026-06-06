import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

export function generateApiKey(prefix?: string) {
  const random = crypto.randomBytes(32).toString("base64url");
  const usePrefix = prefix ?? config.API_KEY_PREFIX;
  return `${usePrefix}-${random}`;
}

export function apiKeyPrefix(apiKey: string) {
  const brandedPrefix = `${config.API_KEY_PREFIX}-`;
  if (apiKey.startsWith(brandedPrefix)) return apiKey.slice(0, brandedPrefix.length + 8);

  const parts = apiKey.split("_");
  if (parts.length < 3) return apiKey.slice(0, 12);
  return `${parts[0]}_${parts[1]}_${parts[2].slice(0, 8)}`;
}

export function hashApiKey(apiKey: string) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function bearerToken(header?: string) {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
