import { NavLink, Route, Routes } from "react-router-dom";
import { ItemPage } from "./pages/ItemPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ProposalsPage } from "./pages/ProposalsPage";
import { SearchPage } from "./pages/SearchPage";
import { TagsPage } from "./pages/TagsPage";

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink className="wordmark" to="/">
          XTome
        </NavLink>
        <nav aria-label="Primary">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/tags">Tags</NavLink>
          <NavLink to="/proposals">Proposals</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/items/:id" element={<ItemPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/proposals" element={<ProposalsPage />} />
        </Routes>
      </main>
    </div>
  );
}
