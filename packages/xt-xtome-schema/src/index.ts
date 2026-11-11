import taxonomyJson from "../taxonomy.json" with { type: "json" };

/** Width of items.embeddings.embedding. A different model width needs a new migration. */
export const EMBEDDING_DIMENSIONS = 1536;

export type Cardinality = "one" | "many";
export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface FacetDefinition {
  key: string;
  label: string;
  description: string;
  cardinality: Cardinality;
  sort_order: number;
}

export interface TagDefinition {
  facet: string;
  key: string;
  label: string;
}

export interface Taxonomy {
  facets: FacetDefinition[];
  tags: TagDefinition[];
}

export interface Item {
  id: string;
  title: string;
  source: string;
  duration_ms: number | null;
  storage_key: string | null;
  content_type: string | null;
  /** node-pg returns bigint as a string. */
  byte_size: string | null;
  description: string | null;
  transcript: string | null;
  rating: number | null;
  favorite: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Facet {
  id: string;
  key: string;
  label: string;
  description: string | null;
  cardinality: Cardinality;
  sort_order: number;
  created_at: Date;
}

export interface Tag {
  id: string;
  facet_id: string;
  key: string;
  label: string;
  created_at: Date;
}

export interface ItemTag {
  item_id: string;
  tag_id: string;
  origin: string;
  created_at: Date;
}

export interface Note {
  id: string;
  item_id: string;
  body: string;
  created_at: Date;
  updated_at: Date;
}

export interface Embedding {
  id: string;
  item_id: string;
  model: string;
  dimensions: number;
  content_hash: string;
  /** Text form returned by Postgres, such as "[0,1,2]". */
  embedding: string;
  updated_at: Date;
}

export interface TagProposal {
  id: string;
  item_id: string;
  tag_id: string;
  status: ProposalStatus;
  rationale: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCardinality(value: unknown): value is Cardinality {
  return value === "one" || value === "many";
}

function readKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new Error(`${label} must match ${KEY_PATTERN}`);
  }
  return value;
}

function readLabel(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function loadTaxonomy(raw: unknown = taxonomyJson): Taxonomy {
  if (!isRecord(raw) || !Array.isArray(raw.facets) || !Array.isArray(raw.tags)) {
    throw new Error("taxonomy.json must contain facets and tags arrays");
  }

  const facets: FacetDefinition[] = [];
  const facetKeys = new Set<string>();
  for (const entry of raw.facets) {
    if (!isRecord(entry)) {
      throw new Error("each facet must be an object");
    }
    const key = readKey(entry.key, "facet key");
    if (facetKeys.has(key)) {
      throw new Error(`duplicate facet key ${key}`);
    }
    facetKeys.add(key);
    if (!isCardinality(entry.cardinality)) {
      throw new Error(`facet ${key} cardinality must be one or many`);
    }
    if (typeof entry.description !== "string" || entry.description.length === 0) {
      throw new Error(`facet ${key} description must be a non-empty string`);
    }
    if (typeof entry.sort_order !== "number" || !Number.isInteger(entry.sort_order)) {
      throw new Error(`facet ${key} sort_order must be an integer`);
    }
    facets.push({
      key,
      label: readLabel(entry.label, `facet ${key} label`),
      description: entry.description,
      cardinality: entry.cardinality,
      sort_order: entry.sort_order,
    });
  }

  const tags: TagDefinition[] = [];
  const tagKeys = new Set<string>();
  for (const entry of raw.tags) {
    if (!isRecord(entry)) {
      throw new Error("each tag must be an object");
    }
    const facet = readKey(entry.facet, "tag facet");
    const key = readKey(entry.key, "tag key");
    if (!facetKeys.has(facet)) {
      throw new Error(`tag ${key} refers to unknown facet ${facet}`);
    }
    const pair = `${facet}:${key}`;
    if (tagKeys.has(pair)) {
      throw new Error(`duplicate tag ${pair}`);
    }
    tagKeys.add(pair);
    tags.push({
      facet,
      key,
      label: readLabel(entry.label, `tag ${pair} label`),
    });
  }

  return { facets, tags };
}

export const taxonomy = loadTaxonomy();

export { starterFacetKeys } from "./starter-facet-key.js";
export type { StarterFacetKey } from "./starter-facet-key.js";
