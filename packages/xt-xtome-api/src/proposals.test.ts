import assert from "node:assert/strict";
import test from "node:test";
import { acceptAssignment, insertPendingProposals, selectProposalTags } from "./proposals.js";

const vocabulary = [
  { id: "tag-calm", facet: "mood", key: "calm" },
  { id: "tag-jazz", facet: "genre", key: "jazz" },
];

test("proposal selection keeps known tags that are not already on the item", () => {
  const chosen = selectProposalTags(
    vocabulary,
    [
      { facet: "mood", key: "calm", rationale: "soft pace" },
      { facet: "genre", key: "jazz", rationale: "already applied" },
      { facet: "tone", key: "invented", rationale: "outside the vocabulary" },
      { facet: "mood", key: "calm", rationale: "duplicate" },
    ],
    new Set(["tag-jazz"]),
  );
  assert.deepEqual(chosen, [{ tagId: "tag-calm", rationale: "soft pace" }]);
});

test("storing proposals writes tag_proposals and leaves item tags alone", async () => {
  const statements: string[] = [];
  await insertPendingProposals(
    async (text) => {
      statements.push(text);
    },
    "item-1",
    [{ tagId: "tag-calm", rationale: null }],
  );
  assert.equal(statements.length, 1);
  assert.match(statements[0] ?? "", /INSERT INTO tag_proposals/);
  assert.equal((statements[0] ?? "").toLowerCase().includes("item_tags"), false);
});

test("accept is the step that records a confirmed tag", () => {
  assert.deepEqual(acceptAssignment("tag-calm"), { tag_id: "tag-calm", origin: "confirmed" });
});
