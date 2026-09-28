"use client";

import { memo, type RefObject } from "react";
import { countdown, fmtInt, useNow, utcClock, VIEWS, type Theme, type View } from "./util";

export interface TopBarProps {
  updatedAt: number;
  nextAt: number;
  loading: boolean;
  shown: number;
  total: number;
  ok: number;
  failed: number;
  batchErrors: number;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  view: View;
  /** ISO2 selected on the globe; null when no country filter is active. */
  country: string | null;
  watchOnly: boolean;
  theme: Theme;
  onSearch: (s: string) => void;
  onView: (v: View) => void;
  onCountry: (iso2: string | null) => void;
  onWatchOnly: () => void;
  onTheme: () => void;
  onRefresh: () => void;
}

function TopBarBase(p: TopBarProps) {
  const now = useNow(1000);
  const next = p.nextAt && now ? `next in ${countdown(p.nextAt - now)}` : "next in -:--";
  const status = p.updatedAt ? `updated ${utcClock(p.updatedAt, false)}` : p.loading || !p.batchErrors ? "loading" : "no data";
  return (
    <header className="topbar">
      <div className="brand">
        <span className="livedot" aria-hidden="true" />
        WORLD WATCHOUT
        <small className="hide-sm">energy · industry · markets</small>
      </div>
      <div className="clock mono" title="Coordinated Universal Time">
        {now ? utcClock(now) : "--:--:--"} <span className="muted">UTC</span>
      </div>
      <div className="upd mono muted" aria-live="off">
        {status}
        {/* the countdown is desktop-only: on a phone it costs a whole top-bar row */}
        <span className="hide-sm"> · {p.loading ? "refreshing" : next}</span>
        {p.batchErrors > 0 && (
          <span className="down" title="Feed batches that could not be fetched this round; their previous headlines are kept">
            {" "}· {p.batchErrors} batch{p.batchErrors > 1 ? "es" : ""} failed
          </span>
        )}
      </div>
      <div className="chips hide-sm">
        <span className="chip" title="items shown / items loaded">
          <b>{fmtInt(p.shown)}</b> / {fmtInt(p.total)} items
        </span>
        <span className="chip" title="source health">
          <span className="hdot ok" aria-hidden="true" /> {p.ok} ok
          <span className="hdot bad" aria-hidden="true" /> {p.failed} failed
        </span>
      </div>
      <input
        ref={p.searchRef}
        className="search"
        type="text"
        placeholder="search headlines   /"
        aria-label="Search headlines (press / to focus, Esc to clear)"
        value={p.search}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => p.onSearch(e.target.value)}
      />
      <div className="tb-right">
        {p.country && (
          <button type="button" className="chip country" onClick={() => p.onCountry(null)} title="Clear the country filter" aria-label={`Clear country filter ${p.country}`}>
            country: <b>{p.country}</b> <span aria-hidden="true">{"×"}</span>
          </button>
        )}
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={p.view === v.id ? "on" : ""} aria-pressed={p.view === v.id} onClick={() => p.onView(v.id)} title={`${v.label} view (v cycles)`}>
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" className="chip" aria-pressed={p.watchOnly} aria-label="Watchlist hits only (w)" onClick={p.onWatchOnly} title="Filter to watchlist hits only (w)">
          <span aria-hidden="true">{"★"}</span><span className="hide-sm"> hits only</span>
        </button>
        <button type="button" className="icon" onClick={p.onTheme} aria-label={`Switch to ${p.theme === "dark" ? "light" : "dark"} theme (t)`} title="Theme (t)">
          {p.theme === "dark" ? "☾" : "☀"}
        </button>
        <button type="button" className="icon" onClick={p.onRefresh} disabled={p.loading} aria-label="Refresh feeds (r)" title="Refresh (r)">
          <svg className={p.loading ? "spin" : ""} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.5 2.5v3.2h-3.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}

const TopBar = memo(TopBarBase);
export default TopBar;
