import type { AdminSession } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    admin?: AdminSession;
  }
}
