import { EMBEDDING_DIMENSIONS } from "xt-xtome-schema";
import type { Config } from "./config.js";
import type { SuggestedTag } from "./proposals.js";

export interface VocabularyEntry {
  facet: string;
  key: string;
  label: string;
}

export interface EmbeddingClient {
  model: string;
  embed(text: string): Promise<number[]>;
  suggestTags(document: string, vocabulary: VocabularyEntry[]): Promise<SuggestedTag[]>;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

interface EmbeddingResponse {
  data?: { embedding?: number[] }[];
}

function trimBase(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function parseSuggestions(content: string): SuggestedTag[] {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    return [];
  }
  const parsed = JSON.parse(content.slice(start, end + 1)) as { tags?: unknown };
  if (!Array.isArray(parsed.tags)) {
    return [];
  }
  const tags: SuggestedTag[] = [];
  for (const entry of parsed.tags) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.facet !== "string" || typeof record.key !== "string") {
      continue;
    }
    tags.push({
      facet: record.facet,
      key: record.key,
      rationale: typeof record.rationale === "string" ? record.rationale : null,
    });
  }
  return tags;
}

export function createEmbeddingClient(config: Config): EmbeddingClient | null {
  if (!config.embeddingBaseUrl || !config.embeddingApiKey) {
    return null;
  }
  const base = trimBase(config.embeddingBaseUrl);
  const headers = {
    authorization: `Bearer ${config.embeddingApiKey}`,
    "content-type": "application/json",
  };

  return {
    model: config.embeddingModel,
    async embed(text: string): Promise<number[]> {
      const response = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.embeddingModel, input: text }),
      });
      if (!response.ok) {
        throw new Error(`Embedding request failed (${response.status}).`);
      }
      const payload = (await response.json()) as EmbeddingResponse;
      const vector = payload.data?.[0]?.embedding;
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding model must return ${EMBEDDING_DIMENSIONS} dimensions.`);
      }
      return vector;
    },
    async suggestTags(document: string, vocabulary: VocabularyEntry[]): Promise<SuggestedTag[]> {
      const vocabularyText = vocabulary
        .map((tag) => `${tag.facet}/${tag.key} (${tag.label})`)
        .join("\n");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.tagModel,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'Choose tags from the given vocabulary only. Reply with JSON {"tags":[{"facet":"mood","key":"calm","rationale":"short reason"}]}. Omit tags that do not fit. Do not invent keys.',
            },
            {
              role: "user",
              content: `Vocabulary:\n${vocabularyText}\n\nItem:\n${document}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Tag request failed (${response.status}).`);
      }
      const payload = (await response.json()) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content ?? "";
      return parseSuggestions(content);
    },
  };
}
