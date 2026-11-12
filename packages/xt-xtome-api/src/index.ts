import { migrate } from "xt-xtome-schema/migrate";
import { seed } from "xt-xtome-schema/seed";
import { loadConfig } from "./config.js";
import { createPool, waitForPostgres } from "./db.js";
import { createEmbeddingClient } from "./embeddings.js";
import { buildServer } from "./server.js";
import { createStorage } from "./storage.js";
import { startWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  await waitForPostgres(pool);
  const storage = createStorage(config);
  if (storage) {
    await storage.ensureBucket();
  }
  const applied = await migrate(config.databaseUrl);
  for (const filename of applied) {
    console.log(`applied ${filename}`);
  }
  const seeded = await seed(config.databaseUrl);
  console.log(`seeded facets=${seeded.facets} tags=${seeded.tags}`);
  const embeddings = createEmbeddingClient(config);
  const app = await buildServer({
    pool,
    storage,
    embeddings,
    webDist: config.webDist,
  });
  const stopWorker = startWorker(pool, embeddings);
  const close = async () => {
    stopWorker();
    await app.close();
    await pool.end();
  };
  process.on("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
