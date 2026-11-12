import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchQuery, searchNeedsEmbedding } from "./search.js";

test("structured search does not ask for an embedding", () => {
  assert.equal(searchNeedsEmbedding({ mode: "structured", query: "calm rain" }), false);
  assert.equal(searchNeedsEmbedding({ mode: "both", query: "   " }), false);
  assert.equal(searchNeedsEmbedding({ mode: "semantic", query: "calm rain" }), true);
  assert.equal(searchNeedsEmbedding({ mode: "both", query: "calm" }), true);
});

test("structured SQL ignores a vector and keeps facet filters", () => {
  const built = buildSearchQuery({
    mode: "structured",
    query: "calm rain",
    filters: [{ facet_key: "mood", tag_keys: ["calm", "tense"] }],
    sort: "rating",
    order: "desc",
    limit: 20,
    vector: [0.2, 0.4],
  });
  assert.equal(built.text.includes("<=>"), false);
  assert.match(built.text, /filter_facet.key/);
  assert.deepEqual(built.values[0], "mood");
  assert.deepEqual(built.values[1], ["calm", "tense"]);
});

test("semantic SQL ranks by distance and skips facet filters", () => {
  const built = buildSearchQuery({
    mode: "semantic",
    query: "quiet close",
    filters: [{ facet_key: "mood", tag_keys: ["calm"] }],
    sort: "created_at",
    order: "desc",
    limit: 10,
    vector: [0.1, 0.2, 0.3],
  });
  assert.match(built.text, /<=>/);
  assert.equal(built.text.includes("filter_facet"), false);
  assert.match(built.text, /e\.embedding IS NOT NULL/);
});
