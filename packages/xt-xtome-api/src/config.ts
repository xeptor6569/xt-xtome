import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  databaseUrl: string;
  s3Endpoint: string | null;
  s3Bucket: string;
  s3AccessKey: string | null;
  s3SecretKey: string | null;
  s3Region: string;
  webDist: string | null;
  embeddingBaseUrl: string | null;
  embeddingApiKey: string | null;
  embeddingModel: string;
  tagModel: string;
}

function loadEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../.env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    for (const line of readFileSync(path, "utf8").split("\n")) {
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
    return;
  }
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function loadConfig(): Config {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set DATABASE_URL (see .env.example).");
  }
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  return {
    port,
    databaseUrl,
    s3Endpoint: blankToNull(process.env.S3_ENDPOINT),
    s3Bucket: process.env.S3_BUCKET?.trim() || "xtome",
    s3AccessKey: blankToNull(process.env.S3_ACCESS_KEY),
    s3SecretKey: blankToNull(process.env.S3_SECRET_KEY),
    s3Region: process.env.S3_REGION?.trim() || "us-east-1",
    webDist: blankToNull(process.env.WEB_DIST),
    embeddingBaseUrl: blankToNull(process.env.EMBEDDING_BASE_URL),
    embeddingApiKey: blankToNull(process.env.EMBEDDING_API_KEY),
    embeddingModel: process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    tagModel: process.env.TAG_MODEL?.trim() || "gpt-4o-mini",
  };
}
