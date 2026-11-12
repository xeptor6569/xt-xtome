import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Proposal } from "../api";
import { formatWhen } from "../format";

export function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const payload = await api<{ proposals: Proposal[] }>("/api/proposals?status=pending");
    setProposals(payload.proposals);
  }

  useEffect(() => {
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load proposals."));
  }, []);

  async function resolve(id: string, action: "accept" | "reject") {
    setError(null);
    try {
      await api(`/api/proposals/${id}/${action}`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resolve the proposal.");
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Proposals</h1>
        <p className="lede">Suggestions wait here. Accepting one attaches the tag. Rejecting one leaves the item unchanged.</p>
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {proposals.length === 0 ? <p className="muted">No proposals are waiting.</p> : null}
      {proposals.map((proposal) => (
        <article className="panel stack" key={proposal.id}>
          <h2>
            <Link to={`/items/${proposal.item_id}`}>{proposal.item_title}</Link>
          </h2>
          <p>
            {proposal.facet_label}: {proposal.tag_label}
          </p>
          {proposal.rationale ? <p>{proposal.rationale}</p> : null}
          <p className="muted">{formatWhen(proposal.created_at)}</p>
          <div className="row">
            <button type="button" onClick={() => void resolve(proposal.id, "accept")}>Accept</button>
            <button className="quiet" type="button" onClick={() => void resolve(proposal.id, "reject")}>Reject</button>
          </div>
        </article>
      ))}
    </div>
  );
}
