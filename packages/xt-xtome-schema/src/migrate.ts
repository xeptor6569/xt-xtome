import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDatabaseUrl } from "./database-url.js";

const { Client } = pg;

export function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    join(here, "../migrations"),
    join(here, "../../xt-xtome-schema/migrations"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find the migrations directory. Set MIGRATIONS_DIR.");
}

export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = resolveMigrationsDir();
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [
        filename,
      ]);
      if (existing.rowCount) {
        continue;
      }

      const sql = readFileSync(join(migrationsDir, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }

  return applied;
}

async function main(): Promise<void> {
  const applied = await migrate(readDatabaseUrl());
  if (applied.length === 0) {
    console.log("schema migrations already applied");
    return;
  }
  for (const filename of applied) {
    console.log(`applied ${filename}`);
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (self === entry && self.endsWith("migrate.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
