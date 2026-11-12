import pg from "pg";
import type { Config } from "./config.js";

const { Pool } = pg;

export type Database = pg.Pool;

export function createPool(config: Config): Database {
  return new Pool({ connectionString: config.databaseUrl });
}

export async function waitForPostgres(pool: Database): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(`Postgres did not become ready. ${message}`);
}
