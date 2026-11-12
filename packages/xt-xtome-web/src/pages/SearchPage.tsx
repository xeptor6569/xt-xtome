import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type Facet, type Health, type ItemSummary } from "../api";
import { formatDuration } from "../format";

export function SearchPage() {
  const [facets, setFacets] = useState<Facet[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("both");
  const [sort, setSort] = useState("created_at");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    Promise.all([api<{ facets: Facet[] }>("/api/facets"), api<Health>("/api/health")])
      .then(([vocabulary, status]) => {
        setFacets(vocabulary.facets);
        setHealth(status);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load search."));
  }, []);

  function toggle(facetKey: string, tagKey: string) {
    setSelected((current) => {
      const keys = new Set(current[facetKey] ?? []);
      if (keys.has(tagKey)) keys.delete(tagKey);
      else keys.add(tagKey);
      return { ...current, [facetKey]: [...keys] };
    });
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const filters = Object.entries(selected)
      .filter(([, keys]) => keys.length > 0)
      .map(([facet_key, tag_keys]) => ({ facet_key, tag_keys }));
    try {
      const payload = await api<{ items: ItemSummary[] }>("/api/search", {
        method: "POST",
        body: JSON.stringify({ query, mode, sort, order: "desc", filters }),
      });
      setItems(payload.items);
      setSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Search</h1>
        <p className="lede">Filter by facet and tag, or rank the library with a free-text query.</p>
      </div>
      {health && !health.embeddings ? (
        <p className="muted">Semantic ranking is waiting on an embedding model. Structured filters stay available.</p>
      ) : null}
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <form className="stack" onSubmit={(event) => void onSearch(event)}>
        <label>
          Query
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="A quiet outdoor take" />
        </label>
        <fieldset>
          <legend>Mode</legend>
          <div className="checks">
            {[
              ["both", "Both"],
              ["structured", "Structured"],
              ["semantic", "Semantic"],
            ].map(([value, label]) => (
              <label key={value}>
                <input type="radio" name="mode" checked={mode === value} onChange={() => setMode(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Sort for structured results
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="created_at">Date</option>
            <option value="rating">Rating</option>
            <option value="duration_ms">Duration</option>
          </select>
        </label>
        {facets.map((facet) => (
          <fieldset key={facet.id}>
            <legend>{facet.label}</legend>
            <div className="checks">
              {facet.tags.map((tag) => (
                <label key={tag.id}>
                  <input
                    type="checkbox"
                    checked={(selected[facet.key] ?? []).includes(tag.key)}
                    onChange={() => toggle(facet.key, tag.key)}
                  />
                  {tag.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="submit">Search</button>
      </form>
      {searched && items.length === 0 ? <p className="muted">No items matched.</p> : null}
      <div className="item-list">
        {items.map((item) => (
          <Link className="panel item-row" key={item.id} to={`/items/${item.id}`}>
            <div>
              <h2>{item.title}</h2>
              <div className="meta">
                <span>{formatDuration(item.duration_ms)}</span>
                <span>{item.rating ? `${item.rating}/5` : "Unrated"}</span>
              </div>
              <div className="chips">
                {item.tags.map((tag) => (
                  <span className="chip" key={tag.id}>{tag.facet_label}: {tag.label}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
