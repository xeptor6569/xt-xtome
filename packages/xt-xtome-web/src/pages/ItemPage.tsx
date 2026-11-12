import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Facet, type ItemDetail } from "../api";
import { formatWhen } from "../format";

export function ItemPage() {
  const { id = "" } = useParams();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagId, setTagId] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    const [nextItem, vocabulary] = await Promise.all([
      api<ItemDetail>(`/api/items/${id}`),
      api<{ facets: Facet[] }>("/api/facets"),
    ]);
    setItem(nextItem);
    setFacets(vocabulary.facets);
  }

  useEffect(() => {
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load this item."));
  }, [id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const duration = String(form.get("duration_ms") ?? "");
    const rating = String(form.get("rating") ?? "");
    setError(null);
    try {
      const next = await api<ItemDetail>(`/api/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.get("title"),
          source: form.get("source"),
          description: form.get("description") || null,
          transcript: form.get("transcript") || null,
          duration_ms: duration === "" ? null : Number(duration),
          rating: rating === "" ? null : Number(rating),
          favorite: form.get("favorite") === "on",
        }),
      });
      setItem(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    }
  }

  async function addTag(event: FormEvent) {
    event.preventDefault();
    if (!tagId) return;
    const next = await api<ItemDetail>(`/api/items/${id}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag_id: tagId }),
    });
    setItem(next);
    setTagId("");
  }

  async function removeTag(tag: string) {
    setItem(await api<ItemDetail>(`/api/items/${id}/tags/${tag}`, { method: "DELETE" }));
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    await api(`/api/items/${id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) });
    setNote("");
    await load();
  }

  async function suggest() {
    setError(null);
    try {
      await api(`/api/items/${id}/proposals/generate`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue suggestions.");
    }
  }

  if (!item) {
    return error ? <p className="alert" role="alert">{error}</p> : <p className="muted">Loading item…</p>;
  }

  const media = item.has_file ? `/api/items/${item.id}/media` : null;
  const kind = item.content_type ?? "";

  return (
    <div className="stack">
      <p><Link to="/">Library</Link></p>
      <h1>{item.title}</h1>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {media && kind.startsWith("audio/") ? <audio controls src={media} /> : null}
      {media && kind.startsWith("video/") ? <video controls src={media} /> : null}
      {media && !kind.startsWith("audio/") && !kind.startsWith("video/") ? (
        <a className="button quiet" href={media}>Open file</a>
      ) : null}
      <form className="panel stack" key={item.updated_at} onSubmit={save}>
        <label>Title<input name="title" defaultValue={item.title} required /></label>
        <label>Source<input name="source" defaultValue={item.source} required /></label>
        <label>Description<textarea name="description" defaultValue={item.description ?? ""} /></label>
        <label>Transcript<textarea name="transcript" defaultValue={item.transcript ?? ""} /></label>
        <div className="row">
          <label>
            Duration (ms)
            <input name="duration_ms" type="number" min="0" defaultValue={item.duration_ms ?? ""} />
          </label>
          <label>
            Rating
            <select name="rating" defaultValue={item.rating ?? ""}>
              <option value="">Unrated</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="checks">
            <input name="favorite" type="checkbox" defaultChecked={item.favorite} /> Favorite
          </label>
        </div>
        <button type="submit">Save details</button>
      </form>
      <section className="panel stack">
        <h2>Tags</h2>
        <div className="chips">
          {item.tags.map((tag) => (
            <button className="chip" key={tag.id} type="button" onClick={() => void removeTag(tag.id)}>
              {tag.facet_label}: {tag.label} ×
            </button>
          ))}
        </div>
        <form className="row" onSubmit={(event) => void addTag(event)}>
          <label>
            Add tag
            <select value={tagId} onChange={(event) => setTagId(event.target.value)}>
              <option value="">Choose a tag</option>
              {facets.map((facet) => (
                <optgroup key={facet.id} label={facet.label}>
                  {facet.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button type="submit">Attach</button>
        </form>
        <div className="row">
          <button className="quiet" type="button" onClick={() => void suggest()}>Suggest tags</button>
          <Link to="/proposals">Review proposals</Link>
        </div>
        {item.proposal_job ? (
          <p className="muted">
            Latest suggestion run: {item.proposal_job.status}
            {item.proposal_job.error ? ` — ${item.proposal_job.error}` : ""}
          </p>
        ) : null}
      </section>
      <section className="panel stack">
        <h2>Notes</h2>
        {item.notes.map((entry) => (
          <article key={entry.id}>
            <p>{entry.body}</p>
            <p className="muted">{formatWhen(entry.created_at)}</p>
          </article>
        ))}
        <form className="stack" onSubmit={(event) => void addNote(event)}>
          <label>
            New note
            <textarea value={note} onChange={(event) => setNote(event.target.value)} required />
          </label>
          <button type="submit">Add note</button>
        </form>
      </section>
    </div>
  );
}
