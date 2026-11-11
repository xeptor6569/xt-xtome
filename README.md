# XTome

XTome is a personal web app for cataloguing a media collection with rich metadata and semantic search. The first library is private audio. The schema stays medium-agnostic so the same tables can later hold books, video, or images.

v1 is a single library: upload, tag, search, note, and rate. Accounts, public sharing, recommendations, and transcoding are out of scope.

## Naming

Product name: XTome. Repository and package prefix: `xt-xtome`.

Shared nouns:

| Noun | Meaning |
| --- | --- |
| item | One work in the library |
| facet | A typed tag group, stored as a row |
| tag | A vocabulary term that belongs to one facet |
| note | Freeform text on an item |
| signal | A person-supplied mark on an item. v1 stores `rating` (1–5) and `favorite` on `items` |

Reserved package names for later apps: `xt-xtome-web`, `xt-xtome-api`. This repository currently ships `xt-xtome-schema` only.

## Repository layout

```
package.json
pnpm-workspace.yaml
docker-compose.yml
.env.example
packages/xt-xtome-schema/
  taxonomy.json          starter facets and tags
  migrations/001_init.sql
  src/index.ts           row types, EMBEDDING_DIMENSIONS, taxonomy loader
  src/migrate.ts
  src/seed.ts
```

`xt-xtome-schema` is the shared contract. A later CLI or bot can import the types and read `taxonomy.json` from this package.

## Schema

Postgres holds the library. Media bytes live in object storage; `items.storage_key` is the pointer. Embeddings use [pgvector](https://github.com/pgvector/pgvector).

- `items` — stable id, title, source, duration, file location, description, transcript, rating, favorite
- `facets` — facet definitions (`genre`, `mood`, `ending`, `tone`, `intensity`, and any later type)
- `tags` — vocabulary terms, unique per facet
- `item_tags` — tag assignments, with `origin` defaulting to `user`
- `notes` — one or many notes per item, included in the semantic document
- `embeddings` — one vector per item (`vector(1536)`), plus model name and content hash
- `tag_proposals` — auto-tag suggestions waiting for a person to accept or reject them

`cardinality` on a facet is `one` or `many`. It is advisory data for a later UI. The database allows several tags from the same facet on one item.

Structured search sorts use indexes on `rating`, `created_at`, and `duration_ms`. Semantic search uses an HNSW index on `embeddings.embedding` with cosine distance.

## Local database

Dev credentials live in `docker-compose.yml` and `.env.example`. Copy the example env file, then start Postgres:

```bash
cp .env.example .env
docker compose up -d
```

The image is `pgvector/pgvector:pg16`, database `xtome`, user `xtome`, password `xtome`.

## Migrations and seed

From the repo root, with Node 22 and pnpm:

```bash
pnpm install
pnpm migrate
pnpm seed
```

`pnpm migrate` applies SQL files in `packages/xt-xtome-schema/migrations` in order and records them in `schema_migrations`. Running it again is a no-op.

`pnpm seed` upserts facets by `key` and tags by `(facet, key)` from `taxonomy.json`. It writes vocabulary rows only. Item, note, proposal, and embedding rows stay as they are. Running it again updates labels in place.

The shipped vocabulary:

- genre (many): ambient, classical, electronic, folk, jazz, narrative
- mood (many): calm, tense, joyful, melancholic, energetic
- ending (many): resolved, ambiguous, open, abrupt
- tone (many): warm, cool, playful, serious, spare
- intensity (one): low, medium, high

## Adding a facet

A new facet type is a row. Existing items are left in place, and no table change is required.

Edit `packages/xt-xtome-schema/taxonomy.json` and run `pnpm seed`:

```json
{
  "key": "pace",
  "label": "Pace",
  "description": "Relative speed of the work.",
  "cardinality": "one",
  "sort_order": 60
}
```

Add matching tag objects with `"facet": "pace"`, then seed again.

The same change can be inserted at runtime:

```sql
INSERT INTO facets (key, label, description, cardinality, sort_order)
VALUES ('pace', 'Pace', 'Relative speed of the work.', 'one', 60);

INSERT INTO tags (facet_id, key, label)
SELECT id, 'slow', 'Slow' FROM facets WHERE key = 'pace';
```

`Facet.key` in the TypeScript row type is `string`, so facets created after the starter file still typecheck. `StarterFacetKey` is the union of keys in `taxonomy.json`. `pnpm typecheck` rewrites that union from the JSON file.

Changing the embedding width is different. `EMBEDDING_DIMENSIONS` in `src/index.ts` and `vector(1536)` in `001_init.sql` are the model contract. A new width is a new migration.

## Tag merge

`merge_tags(source_id, target_id)` keeps item associations. Both tags must share a facet. Associations that already point at the target are kept, the rest move, proposals are repointed, and the source tag is deleted.

```sql
SELECT merge_tags(
  (SELECT id FROM tags WHERE key = 'folk' AND facet_id = (SELECT id FROM facets WHERE key = 'genre')),
  (SELECT id FROM tags WHERE key = 'jazz' AND facet_id = (SELECT id FROM facets WHERE key = 'genre'))
);
```

## Proposals

Auto-tag inserts into `tag_proposals` with `status = 'pending'` and a `tag_id` that already exists. Accepting a proposal is a later step that writes `item_tags`. The schema itself never copies a proposal onto an item.
