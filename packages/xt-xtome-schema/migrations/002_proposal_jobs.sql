-- Queue for auto-tag runs. A finished job may insert tag_proposals.
-- Accepting a proposal is a separate step that writes item_tags.

CREATE TABLE proposal_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT proposal_jobs_status CHECK (status IN ('pending', 'running', 'done', 'failed'))
);

CREATE UNIQUE INDEX proposal_jobs_one_open_per_item
  ON proposal_jobs (item_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX proposal_jobs_status_created_idx
  ON proposal_jobs (status, created_at);

COMMENT ON TABLE proposal_jobs IS 'Auto-tag queue. Completing a job inserts tag_proposals and leaves item_tags unchanged.';
