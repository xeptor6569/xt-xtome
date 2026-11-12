import { EMBEDDING_DIMENSIONS } from "xt-xtome-schema";
import type { Database } from "./db.js";
import { contentHash, semanticDocument } from "./documents.js";
import type { EmbeddingClient } from "./embeddings.js";
import { insertPendingProposals, selectProposalTags } from "./proposals.js";

interface ItemText {
  title: string;
  description: string | null;
  transcript: string | null;
}

async function loadDocument(pool: Database, itemId: string): Promise<{ text: string; hash: string }> {
  const item = await pool.query<ItemText>(
    "SELECT title, description, transcript FROM items WHERE id = $1",
    [itemId],
  );
  const row = item.rows[0];
  if (!row) {
    throw new Error("Item is missing.");
  }
  const tags = await pool.query<{ facet: string; label: string }>(
    `SELECT f.key AS facet, t.label
     FROM item_tags it
     JOIN tags t ON t.id = it.tag_id
     JOIN facets f ON f.id = t.facet_id
     WHERE it.item_id = $1
     ORDER BY f.sort_order, t.key`,
    [itemId],
  );
  const notes = await pool.query<{ body: string }>(
    "SELECT body FROM notes WHERE item_id = $1 ORDER BY created_at",
    [itemId],
  );
  const text = semanticDocument({
    title: row.title,
    description: row.description,
    transcript: row.transcript,
    tags: tags.rows,
    notes: notes.rows.map((note) => note.body),
  });
  return { text, hash: contentHash(text) };
}

async function refreshEmbeddings(pool: Database, embeddings: EmbeddingClient): Promise<void> {
  const items = await pool.query<{ id: string; content_hash: string | null }>(
    `SELECT i.id, e.content_hash
     FROM items i
     LEFT JOIN embeddings e ON e.item_id = i.id
     ORDER BY i.updated_at DESC
     LIMIT 25`,
  );
  for (const item of items.rows) {
    const document = await loadDocument(pool, item.id);
    if (document.hash === item.content_hash || document.text.length === 0) {
      continue;
    }
    const vector = await embeddings.embed(document.text);
    await pool.query(
      `INSERT INTO embeddings (item_id, model, dimensions, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (item_id) DO UPDATE
       SET model = EXCLUDED.model,
           dimensions = EXCLUDED.dimensions,
           content_hash = EXCLUDED.content_hash,
           embedding = EXCLUDED.embedding`,
      [item.id, embeddings.model, EMBEDDING_DIMENSIONS, document.hash, `[${vector.join(",")}]`],
    );
  }
}

async function claimJob(pool: Database): Promise<{ id: string; item_id: string } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; item_id: string }>(
      `UPDATE proposal_jobs
       SET status = 'running', started_at = now()
       WHERE id = (
         SELECT id FROM proposal_jobs
         WHERE status = 'pending'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, item_id`,
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finishJob(pool: Database, jobId: string, error: string | null): Promise<void> {
  await pool.query(
    `UPDATE proposal_jobs
     SET status = $2, error = $3, finished_at = now()
     WHERE id = $1`,
    [jobId, error ? "failed" : "done", error],
  );
}

async function runOneProposalJob(pool: Database, embeddings: EmbeddingClient | null): Promise<void> {
  const job = await claimJob(pool);
  if (!job) {
    return;
  }
  if (!embeddings) {
    await finishJob(
      pool,
      job.id,
      "Tag suggestions are unavailable until the embedding model is configured.",
    );
    return;
  }
  try {
    const document = await loadDocument(pool, job.item_id);
    const vocabulary = await pool.query<{ id: string; facet: string; key: string; label: string }>(
      `SELECT t.id, f.key AS facet, t.key, t.label
       FROM tags t
       JOIN facets f ON f.id = t.facet_id
       ORDER BY f.sort_order, t.key`,
    );
    const existing = await pool.query<{ tag_id: string }>(
      "SELECT tag_id FROM item_tags WHERE item_id = $1",
      [job.item_id],
    );
    const suggestions = await embeddings.suggestTags(document.text, vocabulary.rows);
    const rows = selectProposalTags(
      vocabulary.rows,
      suggestions,
      new Set(existing.rows.map((row) => row.tag_id)),
    );
    await insertPendingProposals(
      (text, values) => pool.query(text, values),
      job.item_id,
      rows,
    );
    await finishJob(pool, job.id, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tag suggestion failed.";
    await finishJob(pool, job.id, message);
  }
}

export function startWorker(pool: Database, embeddings: EmbeddingClient | null): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      if (embeddings) {
        await refreshEmbeddings(pool, embeddings);
      }
      await runOneProposalJob(pool, embeddings);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  };
  void pool
    .query("UPDATE proposal_jobs SET status = 'pending', started_at = NULL WHERE status = 'running'")
    .then(() => tick())
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  const timer = setInterval(() => {
    void tick();
  }, 5000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
