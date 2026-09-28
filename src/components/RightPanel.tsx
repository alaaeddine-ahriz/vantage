"use client";

import { memo, useMemo, useState, type FormEvent } from "react";
import type { NewsItem } from "@/lib/types";
import Section from "./Section";
import { exportCsv, exportMd, relativeTime, type Health } from "./util";

/** Failed sources listed before the panel folds the rest behind a "+N more" button. */
const FAILED_SHOWN = 6;

export interface RightPanelProps {
  watchlist: string[];
  watchCounts: number[];
  saved: NewsItem[];
  health: Health;
  now: number;
  narrow: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onAddWatch: (term: string) => void;
  onRemoveWatch: (term: string) => void;
  onSearchTerm: (term: string) => void;
  onUnsave: (id: string) => void;
  onClearSaved: () => void;
}

function RightPanelBase(p: RightPanelProps) {
  const [term, setTerm] = useState("");
  const [allFailed, setAllFailed] = useState(false);
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
  const failedShown = allFailed ? h.failedList : h.failedList.slice(0, FAILED_SHOWN);
  const failedHidden = h.failedList.length - failedShown.length;
  const isOpen = (id: string) => !p.collapsed.has(id);
  const hitsTotal = p.watchCounts.reduce((a, b) => a + b, 0);

  if (p.collapsed.has("right")) {
    const label = `${p.watchlist.length} terms · ${hitsTotal} hits · ${p.saved.length} saved · ${h.failed} failed`;
    return (
      <aside className={`right rail${p.narrow ? " flat" : ""}`} aria-label="Watchlist, saved items and source health (collapsed)">
        <button type="button" className="plain railbtn" aria-expanded={false} onClick={() => p.onToggle("right")} title="Expand panel">
          <span className="chev-h" aria-hidden="true">◂</span>
          <span className="chev-v" aria-hidden="true">▴</span>
          <span className="railtxt">{label}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="right" aria-label="Watchlist, saved items and source health">
      <div className="panelhead">
        <span className="lbl">Workspace</span>
        <button type="button" className="plain" onClick={() => p.onToggle("right")} aria-expanded={true} title="Collapse panel" aria-label="Collapse panel">
          <span className="chev-h" aria-hidden="true">▸</span>
          <span className="chev-v" aria-hidden="true">▾</span>
        </button>
      </div>

      <Section id="watchlist" title="Watchlist" count={p.watchlist.length} open={isOpen("watchlist")} onToggle={p.onToggle} summary={`${hitsTotal} hits in the current window`}>
        <form className="form" onSubmit={add}>
          <input type="text" value={term} placeholder="add term" aria-label="New watchlist term" onChange={(e) => setTerm(e.target.value)} />
          <button type="submit">Add</button>
        </form>
        <ul className="wl">
          {p.watchlist.map((w, i) => {
            const n = p.watchCounts[i] ?? 0;
            return (
              <li key={w} className={n ? undefined : "zero"}>
                <button type="button" className="term" title="Search this term" onClick={() => p.onSearchTerm(w)}>{w}</button>
                <span className={`cnt${n ? "" : " zero"}`} title="matches in the current window">{n}</span>
                <button type="button" className="plain" aria-label={`Remove ${w} from watchlist`} onClick={() => p.onRemoveWatch(w)}>{"×"}</button>
              </li>
            );
          })}
          {!p.watchlist.length && <li className="muted">no terms: add one above</li>}
        </ul>
      </Section>

      <Section id="saved" title="Saved" count={p.saved.length} open={isOpen("saved")} onToggle={p.onToggle} summary={p.saved.length ? `${p.saved.length} starred` : "nothing starred"}>
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
      </Section>

      <Section id="health" title="Source health" open={isOpen("health")} onToggle={p.onToggle} summary={`${h.ok} ok · ${h.failed} failed`}>
        <div className="hrow">
          <span><span className="hdot ok" aria-hidden="true" /> {h.ok} ok</span>
          <span><span className="hdot bad" aria-hidden="true" /> {h.failed} failed</span>
          <span><span className="hdot" aria-hidden="true" /> {h.pending} pending</span>
        </div>
        {h.failedList.length > 0 && (
          <ul className="fl">
            {failedShown.map((s) => (
              <li key={s.id}>
                <span className="nm" title={s.name}>{s.name}</span>
                <span className="err mono" title={s.error}>{s.error || "failed"}</span>
              </li>
            ))}
          </ul>
        )}
        {(failedHidden > 0 || (allFailed && h.failedList.length > FAILED_SHOWN)) && (
          <button type="button" className="plain morebtn" aria-expanded={allFailed} onClick={() => setAllFailed((o) => !o)}>
            {allFailed ? "show fewer" : `+${failedHidden} more`}
          </button>
        )}
      </Section>
    </aside>
  );
}

const RightPanel = memo(RightPanelBase);
export default RightPanel;
