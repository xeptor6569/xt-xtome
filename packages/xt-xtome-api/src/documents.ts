import { createHash } from "node:crypto";

export interface DocumentInput {
  title: string;
  description: string | null;
  transcript: string | null;
  tags: { facet: string; label: string }[];
  notes: string[];
}

export function semanticDocument(input: DocumentInput): string {
  const tagLine = input.tags.map((tag) => `${tag.facet}: ${tag.label}`).join(", ");
  return [input.title, input.description ?? "", tagLine, input.transcript ?? "", input.notes.join("\n")]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
