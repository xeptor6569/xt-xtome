import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type ItemSummary } from "../api";
import { formatDuration } from "../format";

export function LibraryPage() {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [sort, setSort] = useState("created_at");
  const [order, setOrder] = useState("desc");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const payload = await api<{ items: ItemSummary[] }>(`/api/items?sort=${sort}&order=${order}`);
    setItems(payload.items);
  }

  useEffect(() => {
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the library."));
  }, [sort, order]);

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setUploading(true);
    setError(null);
    try {
      await api("/api/items", { method: "POST", body: data });
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Library</h1>
        <p className="lede">One private collection. Upload a file, then tag, note, and rate it.</p>
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <form className="panel row" onSubmit={onUpload}>
        <label>
          File
          <input name="file" type="file" required />
        </label>
        <label>
          Title
          <input name="title" type="text" placeholder="Optional" />
        </label>
        <button type="submit" disabled={uploading}>
          {uploading ? "Uploading…" : "Add item"}
        </button>
      </form>
      <div className="row">
        <label>
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="created_at">Date</option>
            <option value="rating">Rating</option>
            <option value="duration_ms">Duration</option>
          </select>
        </label>
        <label>
          Order
          <select value={order} onChange={(event) => setOrder(event.target.value)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
      </div>
      {items.length === 0 ? <p className="muted">The library is empty.</p> : null}
      <div className="item-list">
        {items.map((item) => (
          <Link className="panel item-row" key={item.id} to={`/items/${item.id}`}>
            <div>
              <h2>
                {item.favorite ? <span className="star">★ </span> : null}
                {item.title}
              </h2>
              <div className="meta">
                <span>{formatDuration(item.duration_ms)}</span>
                <span>{item.rating ? `${item.rating}/5` : "Unrated"}</span>
                <span>{item.source}</span>
              </div>
              {item.description ? <p>{item.description}</p> : null}
              <div className="chips">
                {item.tags.map((tag) => (
                  <span className="chip" key={tag.id}>
                    {tag.facet_label}: {tag.label}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
