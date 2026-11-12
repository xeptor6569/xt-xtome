import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDatabaseUrl } from "./database-url.js";
import { loadTaxonomy } from "./index.js";

const { Client } = pg;

export interface SeedResult {
  facets: number;
  tags: number;
}

export async function seed(databaseUrl: string): Promise<SeedResult> {
  const taxonomy = loadTaxonomy();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    try {
      for (const facet of taxonomy.facets) {
        await client.query(
          `
            INSERT INTO facets (key, label, description, cardinality, sort_order)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (key) DO UPDATE
            SET label = EXCLUDED.label,
                description = EXCLUDED.description,
                cardinality = EXCLUDED.cardinality,
                sort_order = EXCLUDED.sort_order
          `,
          [facet.key, facet.label, facet.description, facet.cardinality, facet.sort_order],
        );
      }

      for (const tag of taxonomy.tags) {
        await client.query(
          `
            INSERT INTO tags (facet_id, key, label)
            VALUES ((SELECT id FROM facets WHERE key = $1), $2, $3)
            ON CONFLICT (facet_id, key) DO UPDATE
            SET label = EXCLUDED.label
          `,
          [tag.facet, tag.key, tag.label],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }

  return { facets: taxonomy.facets.length, tags: taxonomy.tags.length };
}

async function main(): Promise<void> {
  const result = await seed(readDatabaseUrl());
  console.log(`seeded facets=${result.facets} tags=${result.tags}`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (self === entry && self.endsWith("seed.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
