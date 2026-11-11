-- XTome initial schema.
-- Facet types are rows in facets. Add one with INSERT; existing item rows stay as they are.
-- EMBEDDING_DIMENSIONS = 1536. A different embedding width is a new migration.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source text NOT NULL,
  duration_ms integer,
  storage_key text,
  content_type text,
  byte_size bigint,
  description text,
  transcript text,
  rating smallint,
  favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_title_present CHECK (char_length(title) > 0),
  CONSTRAINT items_source_present CHECK (char_length(source) > 0),
  CONSTRAINT items_duration_ms_nonneg CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT items_byte_size_nonneg CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT items_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

COMMENT ON COLUMN items.rating IS 'Item signal: 1-5 rating.';
COMMENT ON COLUMN items.favorite IS 'Item signal: favorite flag.';
COMMENT ON TABLE items IS 'One library entry. Medium-agnostic: audio, text, video, or image.';

CREATE TABLE facets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  cardinality text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facets_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT facets_label_present CHECK (char_length(label) > 0),
  CONSTRAINT facets_cardinality CHECK (cardinality IN ('one', 'many'))
);

COMMENT ON TABLE facets IS 'Facet types live here as data. Insert a row to add a facet.';

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facet_id uuid NOT NULL REFERENCES facets (id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT tags_label_present CHECK (char_length(label) > 0),
  CONSTRAINT tags_facet_key_unique UNIQUE (facet_id, key)
);

CREATE TABLE item_tags (
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  origin text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, tag_id),
  CONSTRAINT item_tags_origin_present CHECK (char_length(origin) > 0)
);

COMMENT ON COLUMN item_tags.origin IS 'Who attached the tag. Default is user. Confirmation of a proposal uses another origin without a schema change.';

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_body_present CHECK (char_length(body) > 0)
);

COMMENT ON TABLE notes IS 'Freeform notes. Each note is part of the semantic document for its item.';

CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES items (id) ON DELETE CASCADE,
  model text NOT NULL,
  dimensions integer NOT NULL,
  content_hash text NOT NULL,
  -- EMBEDDING_DIMENSIONS = 1536
  embedding vector(1536) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT embeddings_model_present CHECK (char_length(model) > 0),
  CONSTRAINT embeddings_hash_present CHECK (char_length(content_hash) > 0),
  CONSTRAINT embeddings_dimensions_match CHECK (dimensions = 1536)
);

COMMENT ON TABLE embeddings IS 'One semantic vector per item, built from title, description, tags, transcript, and notes.';

CREATE TABLE tag_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT tag_proposals_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

COMMENT ON TABLE tag_proposals IS 'Auto-tag queue. Rows stay here until a person accepts or rejects them.';

CREATE UNIQUE INDEX tag_proposals_one_pending_per_item_tag
  ON tag_proposals (item_id, tag_id)
  WHERE status = 'pending';

CREATE INDEX items_rating_idx ON items (rating);
CREATE INDEX items_created_at_idx ON items (created_at);
CREATE INDEX items_duration_ms_idx ON items (duration_ms);
CREATE INDEX tags_facet_id_idx ON tags (facet_id);
CREATE INDEX item_tags_tag_id_idx ON item_tags (tag_id);
CREATE INDEX notes_item_id_idx ON notes (item_id);
CREATE INDEX tag_proposals_item_id_idx ON tag_proposals (item_id);
CREATE INDEX tag_proposals_tag_id_idx ON tag_proposals (tag_id);

CREATE INDEX embeddings_embedding_hnsw
  ON embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_set_updated_at
BEFORE UPDATE ON items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER notes_set_updated_at
BEFORE UPDATE ON notes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER embeddings_set_updated_at
BEFORE UPDATE ON embeddings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Move item associations and proposals onto target, then delete source.
-- Both tags must belong to the same facet.
CREATE OR REPLACE FUNCTION merge_tags(source_id uuid, target_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  source_facet uuid;
  target_facet uuid;
BEGIN
  IF source_id IS NULL OR target_id IS NULL THEN
    RAISE EXCEPTION 'source and target tags are required';
  END IF;

  IF source_id = target_id THEN
    RAISE EXCEPTION 'source and target tags must differ';
  END IF;

  PERFORM 1
  FROM tags
  WHERE id IN (source_id, target_id)
  ORDER BY id
  FOR UPDATE;

  SELECT facet_id INTO source_facet FROM tags WHERE id = source_id;
  SELECT facet_id INTO target_facet FROM tags WHERE id = target_id;

  IF source_facet IS NULL OR target_facet IS NULL THEN
    RAISE EXCEPTION 'source and target tags must both exist';
  END IF;

  IF source_facet <> target_facet THEN
    RAISE EXCEPTION 'source and target tags must share a facet';
  END IF;

  DELETE FROM item_tags AS source_link
  USING item_tags AS target_link
  WHERE source_link.tag_id = source_id
    AND target_link.tag_id = target_id
    AND source_link.item_id = target_link.item_id;

  UPDATE item_tags
  SET tag_id = target_id
  WHERE tag_id = source_id;

  DELETE FROM tag_proposals AS source_proposal
  USING tag_proposals AS target_proposal
  WHERE source_proposal.tag_id = source_id
    AND source_proposal.status = 'pending'
    AND target_proposal.tag_id = target_id
    AND target_proposal.status = 'pending'
    AND source_proposal.item_id = target_proposal.item_id;

  UPDATE tag_proposals
  SET tag_id = target_id
  WHERE tag_id = source_id;

  DELETE FROM tags WHERE id = source_id;
END;
$$;

COMMENT ON FUNCTION merge_tags(uuid, uuid) IS 'Merge source into target within one facet. Item associations and proposals follow the surviving tag.';
