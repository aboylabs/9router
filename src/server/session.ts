import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { config } from "./config.js";
import { bearerToken } from "./security.js";
import { query } from "./db.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);
const cookieName = "9router_admin";

export type AdminSession = {
  adminId: string;
  email: string;
};

export type SessionRecord = {
  id: string;
  admin_id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_active_at: string;
  expires_at: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(reply: FastifyReply, session: AdminSession, ip?: string, userAgent?: string) {
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);

  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Save to database
  await query(
    `INSERT INTO admin_sessions (admin_id, ip_address, user_agent, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [session.adminId, ip ?? null, userAgent ?? null, tokenHash, expiresAt]
  );

  reply.setCookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE,
    path: "/",
    maxAge: 60 * 60 * 24
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(cookieName, { path: "/" });
}

export async function readSession(request: FastifyRequest): Promise<AdminSession | null> {
  const token = request.cookies?.[cookieName];
  if (!token) return null;

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as Partial<AdminSession>;
    if (!payload.adminId || !payload.email) return null;

    const tokenHash = hashToken(token);
    
    // Check if session exists and is not expired
    const result = await query<SessionRecord>(
      `SELECT id, admin_id, ip_address, user_agent, created_at, last_active_at, expires_at 
       FROM admin_sessions 
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) return null;

    // Update last active time
    await query(
      `UPDATE admin_sessions SET last_active_at = NOW() WHERE token_hash = $1`,
      [tokenHash]
    );

    return { adminId: payload.adminId, email: payload.email };
  } catch {
    return null;
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const headerAdminKey = request.headers["x-admin-api-key"];
  const adminApiKey = Array.isArray(headerAdminKey)
    ? headerAdminKey[0]
    : headerAdminKey ?? bearerToken(request.headers.authorization);
    
  if (config.ADMIN_API_KEY && adminApiKey === config.ADMIN_API_KEY) {
    request.admin = { adminId: "admin-api-key", email: "admin-api-key" };
    return;
  }

  const session = await readSession(request);
  if (!session) {
    return reply.code(401).send({ error: { message: "Admin login required", code: "admin_unauthorized" } });
  }

  request.admin = session;
}

export async function getActiveSessions(adminId: string): Promise<SessionRecord[]> {
  const result = await query<SessionRecord>(
    `SELECT id, admin_id, ip_address, user_agent, created_at, last_active_at, expires_at 
     FROM admin_sessions 
     WHERE admin_id = $1 AND expires_at > NOW()
     ORDER BY last_active_at DESC`,
    [adminId]
  );
  return result.rows;
}

export async function revokeSession(adminId: string, sessionId: string) {
  await query(
    `DELETE FROM admin_sessions WHERE id = $1 AND admin_id = $2`,
    [sessionId, adminId]
  );
}

export async function revokeAllOtherSessions(adminId: string, currentSessionId: string) {
  await query(
    `DELETE FROM admin_sessions WHERE admin_id = $1 AND id != $2`,
    [adminId, currentSessionId]
  );
}
