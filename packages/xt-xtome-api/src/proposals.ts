export interface VocabularyTag {
  id: string;
  facet: string;
  key: string;
}

export interface SuggestedTag {
  facet: string;
  key: string;
  rationale?: string | null;
}

export interface PendingProposal {
  tagId: string;
  rationale: string | null;
}

export interface QueryFn {
  (text: string, values: unknown[]): Promise<unknown>;
}

export function selectProposalTags(
  vocabulary: VocabularyTag[],
  suggestions: SuggestedTag[],
  existingTagIds: ReadonlySet<string>,
): PendingProposal[] {
  const byPair = new Map(vocabulary.map((tag) => [`${tag.facet}:${tag.key}`, tag]));
  const chosen: PendingProposal[] = [];
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const tag = byPair.get(`${suggestion.facet}:${suggestion.key}`);
    if (!tag || existingTagIds.has(tag.id) || seen.has(tag.id)) {
      continue;
    }
    seen.add(tag.id);
    const rationale = suggestion.rationale?.trim() ?? "";
    chosen.push({ tagId: tag.id, rationale: rationale.length > 0 ? rationale : null });
  }
  return chosen;
}

export function acceptAssignment(tagId: string): { tag_id: string; origin: "confirmed" } {
  return { tag_id: tagId, origin: "confirmed" };
}

export async function insertPendingProposals(
  query: QueryFn,
  itemId: string,
  rows: PendingProposal[],
): Promise<void> {
  for (const row of rows) {
    await query(
      `INSERT INTO tag_proposals (item_id, tag_id, status, rationale)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT DO NOTHING`,
      [itemId, row.tagId, row.rationale],
    );
  }
}
