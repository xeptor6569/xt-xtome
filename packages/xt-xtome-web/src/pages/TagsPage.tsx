import { useEffect, useState, type FormEvent } from "react";
import { api, type Facet } from "../api";

export function TagsPage() {
  const [facets, setFacets] = useState<Facet[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const payload = await api<{ facets: Facet[] }>("/api/facets");
    setFacets(payload.facets);
  }

  useEffect(() => {
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load tags."));
  }, []);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the vocabulary.");
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Tags</h1>
        <p className="lede">Facets and tags live in one vocabulary. Merge keeps the items attached to the surviving tag.</p>
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <form
        className="panel row"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void run(async () => {
            await api("/api/facets", {
              method: "POST",
              body: JSON.stringify({
                key: data.get("key"),
                label: data.get("label"),
                description: data.get("description"),
                cardinality: data.get("cardinality"),
              }),
            });
            form.reset();
          });
        }}
      >
        <label>Key<input name="key" required pattern="[a-z][a-z0-9_]*" /></label>
        <label>Label<input name="label" required /></label>
        <label>Description<input name="description" /></label>
        <label>
          Cardinality
          <select name="cardinality" defaultValue="many">
            <option value="many">Many</option>
            <option value="one">One</option>
          </select>
        </label>
        <button type="submit">Add facet</button>
      </form>
      <div className="facet-grid">
        {facets.map((facet) => (
          <FacetCard key={facet.id} facet={facet} onChange={run} />
        ))}
      </div>
    </div>
  );
}

function FacetCard({ facet, onChange }: { facet: Facet; onChange: (work: () => Promise<unknown>) => Promise<void> }) {
  const [label, setLabel] = useState(facet.label);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");

  useEffect(() => setLabel(facet.label), [facet.label]);

  function renameFacet(event: FormEvent) {
    event.preventDefault();
    void onChange(() => api(`/api/facets/${facet.id}`, { method: "PATCH", body: JSON.stringify({ label }) }));
  }

  function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void onChange(async () => {
      await api("/api/tags", {
        method: "POST",
        body: JSON.stringify({ facet_id: facet.id, key: data.get("key"), label: data.get("label") }),
      });
      form.reset();
    });
  }

  return (
    <section className="panel stack">
      <form className="row" onSubmit={renameFacet}>
        <label>
          {facet.key}
          <input value={label} onChange={(event) => setLabel(event.target.value)} aria-label={`${facet.label} label`} />
        </label>
        <button className="quiet" type="submit">Rename facet</button>
        <button
          className="danger"
          type="button"
          onClick={() => {
            if (window.confirm(`Delete the ${facet.label} facet and its tags?`)) {
              void onChange(() => api(`/api/facets/${facet.id}`, { method: "DELETE" }));
            }
          }}
        >
          Delete facet
        </button>
      </form>
      <p className="muted">{facet.cardinality === "one" ? "One tag is the usual choice." : "Several tags can sit on one item."}</p>
      {facet.tags.map((tag) => (
        <TagRow key={tag.id} tag={tag} onChange={onChange} />
      ))}
      <form className="row" onSubmit={addTag}>
        <label>New key<input name="key" required pattern="[a-z][a-z0-9_]*" /></label>
        <label>New label<input name="label" required /></label>
        <button type="submit">Add tag</button>
      </form>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void onChange(() =>
            api("/api/tags/merge", {
              method: "POST",
              body: JSON.stringify({ source_id: source, target_id: target }),
            }),
          );
        }}
      >
        <label>
          Merge from
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Source</option>
            {facet.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.label}</option>
            ))}
          </select>
        </label>
        <label>
          into
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Target</option>
            {facet.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!source || !target || source === target}>Merge</button>
      </form>
    </section>
  );
}

function TagRow({
  tag,
  onChange,
}: {
  tag: { id: string; label: string };
  onChange: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState(tag.label);
  useEffect(() => setLabel(tag.label), [tag.label]);
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        void onChange(() => api(`/api/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ label }) }));
      }}
    >
      <label>
        Tag label
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <button className="quiet" type="submit">Rename</button>
      <button
        className="danger"
        type="button"
        onClick={() => void onChange(() => api(`/api/tags/${tag.id}`, { method: "DELETE" }))}
      >
        Delete
      </button>
    </form>
  );
}
