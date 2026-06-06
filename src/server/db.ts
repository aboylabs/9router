import pg from "pg";
import type { QueryResultRow } from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20
});

// Timezone already set via PGTZ env var in postgres container

export type Db = Pick<pg.Pool, "query" | "connect">;

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export async function closeDb() {
  await pool.end();
}
