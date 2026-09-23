import "server-only";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { requireEnv } from "../server/env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let db: Db | null = null;

const isLocal = (url: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);

export function getDb(): Db {
  if (db) return db;
  const url = requireEnv("DATABASE_URL", "document storage");
  db = isLocal(url)
    ? drizzlePg({ client: new pg.Pool({ connectionString: url, max: 5 }), schema })
    : drizzleNeon({ client: new NeonPool({ connectionString: url }), schema });
  return db;
}
