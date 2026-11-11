import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function applyEnvFile(path: string): void {
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function readDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    const packageDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(packageDir, "../../../.env"),
      resolve(process.cwd(), ".env"),
      resolve(process.cwd(), "../../.env"),
    ];
    for (const path of candidates) {
      if (existsSync(path)) {
        applyEnvFile(path);
        break;
      }
    }
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set DATABASE_URL (see .env.example).");
  }
  return databaseUrl;
}
