import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { EMBEDDING_DIMENSIONS } from "xt-xtome-schema";
import type { Database } from "./db.js";
import type { EmbeddingClient } from "./embeddings.js";
import {
  HttpError,
  optionalText,
  requireRecord,
  requireText,
  requireUuid,
  rethrowAsHttp,
} from "./http.js";
import { acceptAssignment } from "./proposals.js";
import {
  buildSearchQuery,
  searchNeedsEmbedding,
  type SearchMode,
  type SearchOrder,
  type SearchSort,
} from "./search.js";
import type { ObjectStorage } from "./storage.js";

interface TagRow {
  id: string;
  key: string;
  label: string;
  facet_key: string;
  facet_label: string;
  origin?: string;
}

interface ItemRow {
  id: string;
  title: string;
  source: string;
  duration_ms: number | null;
  content_type: string | null;
  byte_size: string | null;
  description: string | null;
  rating: number | null;
  favorite: boolean;
  created_at: Date;
  updated_at: Date;
  has_file: boolean;
  distance?: number | null;
  tags: TagRow[] | string;
}

const SORTS = new Set<SearchSort>(["rating", "created_at", "duration_ms"]);
const ORDERS = new Set<SearchOrder>(["asc", "desc"]);
const MODES = new Set<SearchMode>(["structured", "semantic", "both"]);
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function tagsOf(value: TagRow[] | string): TagRow[] {
  if (Array.isArray(value)) {
    return value;
  }
  return JSON.parse(value) as TagRow[];
}

function publicListItem(row: ItemRow) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    duration_ms: row.duration_ms,
    content_type: row.content_type,
    byte_size: row.byte_size === null ? null : Number(row.byte_size),
    description: row.description,
    rating: row.rating,
    favorite: row.favorite,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_file: row.has_file,
    distance: row.distance ?? null,
    tags: tagsOf(row.tags),
  };
}

function sortClause(sort: SearchSort, order: SearchOrder): string {
  const column = {
    rating: "i.rating",
    created_at: "i.created_at",
    duration_ms: "i.duration_ms",
  }[sort];
  return `${column} ${order === "asc" ? "ASC" : "DESC"} NULLS LAST, i.created_at DESC`;
}

function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return cleaned.length > 0 ? cleaned : "file";
}

function titleFromFileName(name: string): string {
  const base = safeFileName(name).replace(/\.[^.]+$/, "");
  return base.length > 0 ? base : "Untitled";
}

export interface RouteDeps {
  pool: Database;
  storage: ObjectStorage | null;
  embeddings: EmbeddingClient | null;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { pool } = deps;

  app.get("/api/health", async () => ({
    ok: true,
    embeddings: deps.embeddings !== null,
    storage: deps.storage !== null,
  }));

  app.get("/api/items", async (request) => {
    const query = request.query as Record<string, unknown>;
    const sort = SORTS.has(query.sort as SearchSort) ? (query.sort as SearchSort) : "created_at";
    const order = ORDERS.has(query.order as SearchOrder) ? (query.order as SearchOrder) : "desc";
    const result = await pool.query<ItemRow>(
      `SELECT i.id, i.title, i.source, i.duration_ms, i.content_type, i.byte_size,
              i.description, i.rating, i.favorite, i.created_at, i.updated_at,
              (i.storage_key IS NOT NULL) AS has_file,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object(
                  'id', t.id, 'key', t.key, 'label', t.label,
                  'facet_key', f.key, 'facet_label', f.label, 'origin', it.origin
                )) FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS tags
       FROM items i
       LEFT JOIN item_tags it ON it.item_id = i.id
       LEFT JOIN tags t ON t.id = it.tag_id
       LEFT JOIN facets f ON f.id = t.facet_id
       GROUP BY i.id
       ORDER BY ${sortClause(sort, order)}`,
    );
    return { items: result.rows.map(publicListItem) };
  });

  app.post("/api/items", async (request, reply) => {
    if (!deps.storage) {
      throw new HttpError(503, "Object storage is not configured.");
    }
    const file = await request.file();
    if (!file) {
      throw new HttpError(400, "Choose a file to upload.");
    }
    const titleField = file.fields.title;
    const descriptionField = file.fields.description;
    const providedTitle =
      titleField && !Array.isArray(titleField) && "value" in titleField
        ? String(titleField.value).trim()
        : "";
    const description =
      descriptionField && !Array.isArray(descriptionField) && "value" in descriptionField
        ? String(descriptionField.value).trim()
        : "";
    const id = randomUUID();
    const storageKey = `items/${id}/${safeFileName(file.filename)}`;
    const contentType = file.mimetype || "application/octet-stream";
    const payload = await file.toBuffer();
    if (payload.byteLength <= 0) {
      throw new HttpError(400, "The uploaded file is empty.");
    }
    try {
      await deps.storage.put(storageKey, payload, contentType);
      const byteSize = payload.byteLength;
      await pool.query(
        `INSERT INTO items (id, title, source, storage_key, content_type, byte_size, description)
         VALUES ($1, $2, 'upload', $3, $4, $5, $6)`,
        [id, providedTitle || titleFromFileName(file.filename), storageKey, contentType, byteSize, description || null],
      );
    } catch (error) {
      await deps.storage.remove(storageKey).catch(() => undefined);
      rethrowAsHttp(error);
    }
    reply.code(201);
    return loadItem(pool, id);
  });

  app.get("/api/items/:id", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Item id");
    return loadItem(pool, id);
  });

  app.patch("/api/items/:id", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Item id");
    const body = requireRecord(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if ("title" in body) {
      assign("title", requireText(body.title, "Title"));
    }
    if ("source" in body) {
      assign("source", requireText(body.source, "Source"));
    }
    if ("description" in body) {
      assign("description", optionalText(body.description));
    }
    if ("transcript" in body) {
      assign("transcript", optionalText(body.transcript));
    }
    if ("duration_ms" in body) {
      if (body.duration_ms === null) {
        assign("duration_ms", null);
      } else if (typeof body.duration_ms === "number" && Number.isInteger(body.duration_ms) && body.duration_ms >= 0) {
        assign("duration_ms", body.duration_ms);
      } else {
        throw new HttpError(400, "Duration must be a whole number of milliseconds, or empty.");
      }
    }
    if ("rating" in body) {
      if (body.rating === null) {
        assign("rating", null);
      } else if (typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5) {
        assign("rating", body.rating);
      } else {
        throw new HttpError(400, "Rating must be from 1 to 5, or empty.");
      }
    }
    if ("favorite" in body) {
      if (typeof body.favorite !== "boolean") {
        throw new HttpError(400, "Favorite must be true or false.");
      }
      assign("favorite", body.favorite);
    }
    if (sets.length === 0) {
      throw new HttpError(400, "No item fields to update.");
    }
    values.push(id);
    try {
      const result = await pool.query(`UPDATE items SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      if (result.rowCount === 0) {
        throw new HttpError(404, "Item not found.");
      }
    } catch (error) {
      rethrowAsHttp(error);
    }
    return loadItem(pool, id);
  });

  app.delete("/api/items/:id", async (request, reply) => {
    const id = requireUuid((request.params as { id: string }).id, "Item id");
    const existing = await pool.query<{ storage_key: string | null }>(
      "SELECT storage_key FROM items WHERE id = $1",
      [id],
    );
    const item = existing.rows[0];
    if (!item) {
      throw new HttpError(404, "Item not found.");
    }
    await pool.query("DELETE FROM items WHERE id = $1", [id]);
    if (item.storage_key && deps.storage) {
      await deps.storage.remove(item.storage_key).catch(() => undefined);
    }
    reply.code(204);
    return null;
  });

  app.get("/api/items/:id/media", async (request, reply) => {
    const id = requireUuid((request.params as { id: string }).id, "Item id");
    if (!deps.storage) {
      throw new HttpError(503, "Object storage is not configured.");
    }
    const result = await pool.query<{
      storage_key: string | null;
      content_type: string | null;
      byte_size: string | null;
    }>("SELECT storage_key, content_type, byte_size FROM items WHERE id = $1", [id]);
    const item = result.rows[0];
    if (!item?.storage_key) {
      throw new HttpError(404, "This item has no file.");
    }
    const total = item.byte_size === null ? null : Number(item.byte_size);
    const rangeHeader = request.headers.range;
    let range: string | undefined;
    let status = 200;
    if (rangeHeader && total !== null) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : total - 1;
        if (start <= end && start < total) {
          const boundedEnd = Math.min(end, total - 1);
          range = `bytes=${start}-${boundedEnd}`;
          status = 206;
          reply.header("content-range", `bytes ${start}-${boundedEnd}/${total}`);
        }
      }
    }
    const object = await deps.storage.get(item.storage_key, range);
    reply.code(status);
    reply.header("accept-ranges", "bytes");
    reply.header("content-type", object.contentType ?? item.content_type ?? "application/octet-stream");
    if (object.contentLength !== undefined) {
      reply.header("content-length", String(object.contentLength));
    }
    return reply.send(object.body);
  });

  app.post("/api/items/:id/tags", async (request) => {
    const itemId = requireUuid((request.params as { id: string }).id, "Item id");
    const tagId = requireUuid(requireRecord(request.body).tag_id, "Tag id");
    try {
      await pool.query(
        `INSERT INTO item_tags (item_id, tag_id, origin) VALUES ($1, $2, 'user')
         ON CONFLICT DO NOTHING`,
        [itemId, tagId],
      );
    } catch (error) {
      rethrowAsHttp(error);
    }
    return loadItem(pool, itemId);
  });

  app.delete("/api/items/:id/tags/:tagId", async (request) => {
    const itemId = requireUuid((request.params as { id: string }).id, "Item id");
    const tagId = requireUuid((request.params as { tagId: string }).tagId, "Tag id");
    await pool.query("DELETE FROM item_tags WHERE item_id = $1 AND tag_id = $2", [itemId, tagId]);
    return loadItem(pool, itemId);
  });

  app.get("/api/items/:id/notes", async (request) => {
    const itemId = requireUuid((request.params as { id: string }).id, "Item id");
    const notes = await pool.query(
      "SELECT id, item_id, body, created_at, updated_at FROM notes WHERE item_id = $1 ORDER BY created_at",
      [itemId],
    );
    return { notes: notes.rows };
  });

  app.post("/api/items/:id/notes", async (request, reply) => {
    const itemId = requireUuid((request.params as { id: string }).id, "Item id");
    const body = requireText(requireRecord(request.body).body, "Note");
    try {
      const result = await pool.query(
        `INSERT INTO notes (item_id, body) VALUES ($1, $2)
         RETURNING id, item_id, body, created_at, updated_at`,
        [itemId, body],
      );
      reply.code(201);
      return result.rows[0];
    } catch (error) {
      rethrowAsHttp(error);
    }
  });

  app.patch("/api/notes/:id", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Note id");
    const body = requireText(requireRecord(request.body).body, "Note");
    const result = await pool.query(
      `UPDATE notes SET body = $1 WHERE id = $2
       RETURNING id, item_id, body, created_at, updated_at`,
      [body, id],
    );
    if (!result.rows[0]) {
      throw new HttpError(404, "Note not found.");
    }
    return result.rows[0];
  });

  app.delete("/api/notes/:id", async (request, reply) => {
    const id = requireUuid((request.params as { id: string }).id, "Note id");
    const result = await pool.query("DELETE FROM notes WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      throw new HttpError(404, "Note not found.");
    }
    reply.code(204);
    return null;
  });

  app.get("/api/facets", async () => {
    const facets = await pool.query(
      `SELECT id, key, label, description, cardinality, sort_order, created_at
       FROM facets ORDER BY sort_order, key`,
    );
    const tags = await pool.query(
      `SELECT id, facet_id, key, label, created_at FROM tags ORDER BY key`,
    );
    return {
      facets: facets.rows.map((facet) => ({
        ...facet,
        tags: tags.rows.filter((tag) => tag.facet_id === facet.id),
      })),
    };
  });

  app.post("/api/facets", async (request, reply) => {
    const body = requireRecord(request.body);
    const key = requireText(body.key, "Facet key");
    if (!KEY_PATTERN.test(key)) {
      throw new HttpError(400, "Facet key must use lowercase letters, numbers, and underscores.");
    }
    const label = requireText(body.label, "Label");
    const description = optionalText(body.description) ?? null;
    const cardinality = body.cardinality === "one" ? "one" : body.cardinality === "many" ? "many" : null;
    if (!cardinality) {
      throw new HttpError(400, "Cardinality must be one or many.");
    }
    const sortOrder = typeof body.sort_order === "number" ? body.sort_order : 100;
    try {
      const result = await pool.query(
        `INSERT INTO facets (key, label, description, cardinality, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, key, label, description, cardinality, sort_order, created_at`,
        [key, label, description, cardinality, sortOrder],
      );
      reply.code(201);
      return result.rows[0];
    } catch (error) {
      rethrowAsHttp(error);
    }
  });

  app.patch("/api/facets/:id", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Facet id");
    const body = requireRecord(request.body);
    const sets: string[] = [];
    const values: unknown[] = [];
    if ("label" in body) {
      values.push(requireText(body.label, "Label"));
      sets.push(`label = $${values.length}`);
    }
    if ("description" in body) {
      values.push(optionalText(body.description));
      sets.push(`description = $${values.length}`);
    }
    if ("cardinality" in body) {
      if (body.cardinality !== "one" && body.cardinality !== "many") {
        throw new HttpError(400, "Cardinality must be one or many.");
      }
      values.push(body.cardinality);
      sets.push(`cardinality = $${values.length}`);
    }
    if (sets.length === 0) {
      throw new HttpError(400, "No facet fields to update.");
    }
    values.push(id);
    const result = await pool.query(
      `UPDATE facets SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id, key, label, description, cardinality, sort_order, created_at`,
      values,
    );
    if (!result.rows[0]) {
      throw new HttpError(404, "Facet not found.");
    }
    return result.rows[0];
  });

  app.delete("/api/facets/:id", async (request, reply) => {
    const id = requireUuid((request.params as { id: string }).id, "Facet id");
    const result = await pool.query("DELETE FROM facets WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      throw new HttpError(404, "Facet not found.");
    }
    reply.code(204);
    return null;
  });

  app.post("/api/tags", async (request, reply) => {
    const body = requireRecord(request.body);
    const facetId = requireUuid(body.facet_id, "Facet id");
    const key = requireText(body.key, "Tag key");
    if (!KEY_PATTERN.test(key)) {
      throw new HttpError(400, "Tag key must use lowercase letters, numbers, and underscores.");
    }
    const label = requireText(body.label, "Label");
    try {
      const result = await pool.query(
        `INSERT INTO tags (facet_id, key, label) VALUES ($1, $2, $3)
         RETURNING id, facet_id, key, label, created_at`,
        [facetId, key, label],
      );
      reply.code(201);
      return result.rows[0];
    } catch (error) {
      rethrowAsHttp(error);
    }
  });

  app.patch("/api/tags/:id", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Tag id");
    const body = requireRecord(request.body);
    const label = requireText(body.label, "Label");
    const key = "key" in body ? requireText(body.key, "Tag key") : null;
    if (key && !KEY_PATTERN.test(key)) {
      throw new HttpError(400, "Tag key must use lowercase letters, numbers, and underscores.");
    }
    try {
      const result = await pool.query(
        `UPDATE tags
         SET label = $1, key = COALESCE($2, key)
         WHERE id = $3
         RETURNING id, facet_id, key, label, created_at`,
        [label, key, id],
      );
      if (!result.rows[0]) {
        throw new HttpError(404, "Tag not found.");
      }
      return result.rows[0];
    } catch (error) {
      rethrowAsHttp(error);
    }
  });

  app.delete("/api/tags/:id", async (request, reply) => {
    const id = requireUuid((request.params as { id: string }).id, "Tag id");
    const result = await pool.query("DELETE FROM tags WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      throw new HttpError(404, "Tag not found.");
    }
    reply.code(204);
    return null;
  });

  app.post("/api/tags/merge", async (request) => {
    const body = requireRecord(request.body);
    const sourceId = requireUuid(body.source_id, "Source tag id");
    const targetId = requireUuid(body.target_id, "Target tag id");
    try {
      await pool.query("SELECT merge_tags($1, $2)", [sourceId, targetId]);
    } catch (error) {
      rethrowAsHttp(error);
    }
    return { ok: true, tag_id: targetId };
  });

  app.post("/api/search", async (request) => {
    const body = requireRecord(request.body);
    const mode = MODES.has(body.mode as SearchMode) ? (body.mode as SearchMode) : null;
    if (!mode) {
      throw new HttpError(400, "Mode must be structured, semantic, or both.");
    }
    const query = typeof body.query === "string" ? body.query : "";
    if (mode === "semantic" && query.trim().length === 0) {
      throw new HttpError(400, "Semantic search needs a text query.");
    }
    const sort = SORTS.has(body.sort as SearchSort) ? (body.sort as SearchSort) : "created_at";
    const order = ORDERS.has(body.order as SearchOrder) ? (body.order as SearchOrder) : "desc";
    const limit = typeof body.limit === "number" ? Math.min(100, Math.max(1, Math.floor(body.limit))) : 50;
    const filters = Array.isArray(body.filters)
      ? body.filters.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return [];
          }
          const record = entry as Record<string, unknown>;
          if (typeof record.facet_key !== "string" || !Array.isArray(record.tag_keys)) {
            return [];
          }
          return [
            {
              facet_key: record.facet_key,
              tag_keys: record.tag_keys.filter((key): key is string => typeof key === "string"),
            },
          ];
        })
      : [];
    let vector: number[] | null = null;
    if (searchNeedsEmbedding({ mode, query })) {
      if (!deps.embeddings) {
        throw new HttpError(503, "Semantic search is unavailable until the embedding model is configured.");
      }
      vector = await deps.embeddings.embed(query.trim());
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new HttpError(502, "The embedding model returned an unexpected width.");
      }
    }
    const built = buildSearchQuery({ mode, query, filters, sort, order, limit, vector });
    const result = await pool.query<ItemRow>(built.text, built.values);
    return { items: result.rows.map(publicListItem) };
  });

  app.get("/api/proposals", async (request) => {
    const status = (request.query as { status?: string }).status ?? "pending";
    if (status !== "pending" && status !== "accepted" && status !== "rejected") {
      throw new HttpError(400, "Status must be pending, accepted, or rejected.");
    }
    const result = await pool.query(
      `SELECT p.id, p.item_id, i.title AS item_title, p.tag_id, t.key AS tag_key, t.label AS tag_label,
              f.key AS facet_key, f.label AS facet_label, p.status, p.rationale, p.created_at, p.resolved_at
       FROM tag_proposals p
       JOIN items i ON i.id = p.item_id
       JOIN tags t ON t.id = p.tag_id
       JOIN facets f ON f.id = t.facet_id
       WHERE p.status = $1
       ORDER BY p.created_at DESC`,
      [status],
    );
    return { proposals: result.rows };
  });

  app.post("/api/items/:id/proposals/generate", async (request, reply) => {
    const itemId = requireUuid((request.params as { id: string }).id, "Item id");
    const item = await pool.query("SELECT id FROM items WHERE id = $1", [itemId]);
    if (!item.rows[0]) {
      throw new HttpError(404, "Item not found.");
    }
    try {
      const inserted = await pool.query(
        `INSERT INTO proposal_jobs (item_id, status)
         VALUES ($1, 'pending')
         ON CONFLICT DO NOTHING
         RETURNING id, item_id, status, error, created_at, started_at, finished_at`,
        [itemId],
      );
      const row =
        inserted.rows[0] ??
        (
          await pool.query(
            `SELECT id, item_id, status, error, created_at, started_at, finished_at
             FROM proposal_jobs
             WHERE item_id = $1 AND status IN ('pending', 'running')
             ORDER BY created_at DESC
             LIMIT 1`,
            [itemId],
          )
        ).rows[0];
      reply.code(202);
      return row;
    } catch (error) {
      rethrowAsHttp(error);
    }
  });

  app.post("/api/proposals/:id/accept", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Proposal id");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const proposal = await client.query<{ item_id: string; tag_id: string; status: string }>(
        "SELECT item_id, tag_id, status FROM tag_proposals WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = proposal.rows[0];
      if (!row) {
        throw new HttpError(404, "Proposal not found.");
      }
      if (row.status !== "pending") {
        throw new HttpError(409, "This proposal is already resolved.");
      }
      const assignment = acceptAssignment(row.tag_id);
      await client.query(
        `INSERT INTO item_tags (item_id, tag_id, origin)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [row.item_id, assignment.tag_id, assignment.origin],
      );
      const updated = await client.query(
        `UPDATE tag_proposals
         SET status = 'accepted', resolved_at = now()
         WHERE id = $1
         RETURNING id, item_id, tag_id, status, rationale, created_at, resolved_at`,
        [id],
      );
      await client.query("COMMIT");
      return updated.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      rethrowAsHttp(error);
    } finally {
      client.release();
    }
  });

  app.post("/api/proposals/:id/reject", async (request) => {
    const id = requireUuid((request.params as { id: string }).id, "Proposal id");
    const result = await pool.query(
      `UPDATE tag_proposals
       SET status = 'rejected', resolved_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, item_id, tag_id, status, rationale, created_at, resolved_at`,
      [id],
    );
    if (!result.rows[0]) {
      const existing = await pool.query("SELECT id FROM tag_proposals WHERE id = $1", [id]);
      throw new HttpError(existing.rows[0] ? 409 : 404, existing.rows[0] ? "This proposal is already resolved." : "Proposal not found.");
    }
    return result.rows[0];
  });
}

async function loadItem(pool: Database, id: string) {
  const item = await pool.query(
    `SELECT id, title, source, duration_ms, content_type, byte_size, description, transcript,
            rating, favorite, created_at, updated_at, (storage_key IS NOT NULL) AS has_file
     FROM items WHERE id = $1`,
    [id],
  );
  const row = item.rows[0];
  if (!row) {
    throw new HttpError(404, "Item not found.");
  }
  const tags = await pool.query(
    `SELECT t.id, t.key, t.label, f.key AS facet_key, f.label AS facet_label, it.origin
     FROM item_tags it
     JOIN tags t ON t.id = it.tag_id
     JOIN facets f ON f.id = t.facet_id
     WHERE it.item_id = $1
     ORDER BY f.sort_order, t.key`,
    [id],
  );
  const notes = await pool.query(
    "SELECT id, item_id, body, created_at, updated_at FROM notes WHERE item_id = $1 ORDER BY created_at",
    [id],
  );
  const job = await pool.query(
    `SELECT id, item_id, status, error, created_at, started_at, finished_at
     FROM proposal_jobs WHERE item_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  return {
    ...row,
    byte_size: row.byte_size === null ? null : Number(row.byte_size),
    tags: tags.rows,
    notes: notes.rows,
    proposal_job: job.rows[0] ?? null,
  };
}
