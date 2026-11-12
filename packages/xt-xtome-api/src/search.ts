export type SearchMode = "structured" | "semantic" | "both";
export type SearchSort = "rating" | "created_at" | "duration_ms";
export type SearchOrder = "asc" | "desc";

export interface SearchFilter {
  facet_key: string;
  tag_keys: string[];
}

export interface SearchInput {
  mode: SearchMode;
  query: string;
  filters: SearchFilter[];
  sort: SearchSort;
  order: SearchOrder;
  limit: number;
  vector: number[] | null;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function searchNeedsEmbedding(input: { mode: SearchMode; query: string }): boolean {
  if (input.mode === "structured") {
    return false;
  }
  if (input.mode === "semantic") {
    return true;
  }
  return input.query.trim().length > 0;
}

function vectorLiteral(values: number[]): string {
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Embedding values must be finite numbers.");
  }
  return `[${values.join(",")}]`;
}

function sortClause(sort: SearchSort, order: SearchOrder): string {
  const column = {
    rating: "i.rating",
    created_at: "i.created_at",
    duration_ms: "i.duration_ms",
  }[sort];
  const direction = order === "asc" ? "ASC" : "DESC";
  return `${column} ${direction} NULLS LAST, i.created_at DESC`;
}

export function buildSearchQuery(input: SearchInput): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const where: string[] = [];
  const useFilters = input.mode !== "semantic";
  const useVector =
    input.mode !== "structured" && input.vector !== null && input.query.trim().length > 0;

  if (input.mode === "semantic") {
    where.push("e.embedding IS NOT NULL");
  }

  if (useFilters) {
    for (const filter of input.filters) {
      if (!KEY_PATTERN.test(filter.facet_key)) {
        continue;
      }
      const keys = filter.tag_keys.filter((key) => KEY_PATTERN.test(key));
      if (keys.length === 0) {
        continue;
      }
      values.push(filter.facet_key);
      const facetParam = `$${values.length}`;
      values.push(keys);
      const keysParam = `$${values.length}`;
      where.push(`EXISTS (
        SELECT 1
        FROM item_tags filter_link
        JOIN tags filter_tag ON filter_tag.id = filter_link.tag_id
        JOIN facets filter_facet ON filter_facet.id = filter_tag.facet_id
        WHERE filter_link.item_id = i.id
          AND filter_facet.key = ${facetParam}
          AND filter_tag.key = ANY(${keysParam}::text[])
      )`);
    }
  }

  let distanceSelect = "NULL::float8 AS distance";
  let orderBy = sortClause(input.sort, input.order);
  if (useVector && input.vector) {
    values.push(vectorLiteral(input.vector));
    const vectorParam = `$${values.length}`;
    distanceSelect = `e.embedding <=> ${vectorParam}::vector AS distance`;
    orderBy = `e.embedding IS NULL, e.embedding <=> ${vectorParam}::vector`;
  }

  values.push(input.limit);
  const limitParam = `$${values.length}`;
  const text = `
    SELECT i.id, i.title, i.source, i.duration_ms, i.content_type, i.byte_size,
           i.description, i.rating, i.favorite, i.created_at, i.updated_at,
           (i.storage_key IS NOT NULL) AS has_file,
           ${distanceSelect},
           COALESCE(
             json_agg(DISTINCT jsonb_build_object(
               'id', t.id,
               'key', t.key,
               'label', t.label,
               'facet_key', f.key,
               'facet_label', f.label
             )) FILTER (WHERE t.id IS NOT NULL),
             '[]'::json
           ) AS tags
    FROM items i
    LEFT JOIN embeddings e ON e.item_id = i.id
    LEFT JOIN item_tags it ON it.item_id = i.id
    LEFT JOIN tags t ON t.id = it.tag_id
    LEFT JOIN facets f ON f.id = t.facet_id
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY i.id, e.embedding
    ORDER BY ${orderBy}
    LIMIT ${limitParam}
  `;
  return { text, values };
}
