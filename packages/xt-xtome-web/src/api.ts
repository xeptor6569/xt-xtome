export interface TagRef {
  id: string;
  key: string;
  label: string;
  facet_key: string;
  facet_label: string;
  origin?: string;
}

export interface ItemSummary {
  id: string;
  title: string;
  source: string;
  duration_ms: number | null;
  content_type: string | null;
  byte_size: number | null;
  description: string | null;
  rating: number | null;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  has_file: boolean;
  distance: number | null;
  tags: TagRef[];
}

export interface Note {
  id: string;
  item_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ProposalJob {
  id: string;
  item_id: string;
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ItemDetail extends Omit<ItemSummary, "distance"> {
  transcript: string | null;
  notes: Note[];
  proposal_job: ProposalJob | null;
}

export interface FacetTag {
  id: string;
  facet_id: string;
  key: string;
  label: string;
}

export interface Facet {
  id: string;
  key: string;
  label: string;
  description: string | null;
  cardinality: "one" | "many";
  sort_order: number;
  tags: FacetTag[];
}

export interface Proposal {
  id: string;
  item_id: string;
  item_title: string;
  tag_id: string;
  tag_key: string;
  tag_label: string;
  facet_key: string;
  facet_label: string;
  status: string;
  rationale: string | null;
  created_at: string;
}

export interface Health {
  ok: boolean;
  embeddings: boolean;
  storage: boolean;
}

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(payload?.error || "Request failed.");
  }
  return payload as T;
}
