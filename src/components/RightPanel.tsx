"use client";

import { memo, useMemo, useState, type FormEvent } from "react";
import type { NewsItem } from "@/lib/types";
import { exportCsv, exportMd, relativeTime, type Health } from "./util";

export interface RightPanelProps {
  watchlist: string[];
  watchCounts: number[];
  saved: NewsItem[];
  health: Health;
  now: number;
  onAddWatch: (term: string) => void;
  onRemoveWatch: (term: string) => void;
  onSearchTerm: (term: string) => void;
  onUnsave: (id: string) => void;
  onClearSaved: () => void;
}

function RightPanelBase(p: RightPanelProps) {
  const [term, setTerm] = useState("");
  const savedTs = useMemo(() => p.saved.map((s) => Date.parse(s.publishedAt) || 0), [p.saved]);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = term.trim();
    if (!t) return;
    p.onAddWatch(t);
    setTerm("");
  };
  const clear = () => {
    if (window.confirm(`Clear all ${p.saved.length} saved items?`)) p.onClearSaved();
  };
  const h = p.health;

  return (
    <aside className="right" aria-label="Watchlist, saved items and source health">
      <section className="sec">
        <div className="lbl">Watchlist <span className="cnt">{p.watchlist.length}</span></div>
        <form className="form" onSubmit={add}>
          <input type="text" value={term} placeholder="add term" aria-label="New watchlist term" onChange={(e) => setTerm(e.target.value)} />
          <button type="submit">Add</button>
        </form>
        <ul className="wl">
          {p.watchlist.map((w, i) => (
            <li key={w}>
              <button type="button" className="term" title="Search this term" onClick={() => p.onSearchTerm(w)}>{w}</button>
              <span className="cnt" title="matches in the current window">{p.watchCounts[i] ?? 0}</span>
              <button type="button" className="plain" aria-label={`Remove ${w} from watchlist`} onClick={() => p.onRemoveWatch(w)}>{"×"}</button>
            </li>
          ))}
          {!p.watchlist.length && <li className="muted">no terms: add one above</li>}
        </ul>
      </section>

      <section className="sec">
        <div className="lbl">Saved <span className="cnt">{p.saved.length}</span></div>
        {p.saved.length ? (
          <>
            <div className="btns">
              <button type="button" onClick={() => exportCsv(p.saved)}>Export CSV</button>
              <button type="button" onClick={() => exportMd(p.saved)}>Export MD</button>
              <button type="button" onClick={clear}>Clear</button>
            </div>
            <ul className="sv">
              {p.saved.map((s, i) => (
                <li key={s.id}>
                  <a href={s.link} target="_blank" rel="noopener noreferrer">{s.title}</a>
                  <span className="muted">
                    {s.publisher ?? s.source} · <span className="mono">{relativeTime(savedTs[i], p.now)}</span>
                  </span>
                  <button type="button" className="plain" aria-label="Remove from saved" onClick={() => p.onUnsave(s.id)}>{"×"}</button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">star a headline to keep it here</p>
        )}
      </section>

      <section className="sec">
        <div className="lbl">Source health</div>
        <div className="hrow">
          <span><span className="hdot ok" aria-hidden="true" /> {h.ok} ok</span>
          <span><span className="hdot bad" aria-hidden="true" /> {h.failed} failed</span>
          <span><span className="hdot" aria-hidden="true" /> {h.pending} pending</span>
        </div>
        {h.failedList.length > 0 && (
          <ul className="fl">
            {h.failedList.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <span className="muted" title={s.error}>{s.error || "failed"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

const RightPanel = memo(RightPanelBase);
export default RightPanel;
