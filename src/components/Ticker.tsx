"use client";

import { memo } from "react";
import type { Quote } from "@/lib/types";
import { formatPct, formatPrice, QUOTE_GROUPS } from "./util";

function Spark({ series }: { series?: number[] }) {
  const pts = (series ?? []).filter((v) => Number.isFinite(v)).slice(-5);
  if (pts.length < 2) return null;
  const w = 34;
  const h = 12;
  const min = Math.min(...pts);
  const span = Math.max(...pts) - min || 1;
  const d = pts
    .map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ q }: { q: Quote }) {
  const pct = q.changePct;
  const dir = pct === null || !Number.isFinite(pct) || pct === 0 ? "flat" : pct > 0 ? "up" : "down";
  const unit = [q.currency, q.unit].filter(Boolean).join("/");
  const title = [q.symbol, q.note ?? `provider: ${q.provider}`, q.time ? `as of ${q.time}` : ""].filter(Boolean).join(" | ");
  return (
    <div className={`tile ${dir}`} title={title} role="listitem">
      <div className="tl">
        <span>{q.label}</span>
        <span>{unit}</span>
      </div>
      <div className="tv">
        <span className={q.price === null ? "muted" : ""}>{formatPrice(q)}</span>
        <span className="tp">{formatPct(pct)}</span>
        <Spark series={q.series} />
      </div>
    </div>
  );
}

function TickerBase({ quotes, error }: { quotes: Quote[] | null; error: boolean }) {
  if (!quotes) {
    return (
      <div className="ticker">
        <div className="tile note muted">{error ? "markets unavailable" : "loading markets"}</div>
      </div>
    );
  }
  const groups = QUOTE_GROUPS.map((g) => ({ ...g, qs: quotes.filter((q) => q.group === g.id) })).filter((g) => g.qs.length);
  return (
    <div className="ticker" role="list" aria-label="Market quotes">
      {error && <div className="tile note muted" title="Last refresh of market data failed">markets stale</div>}
      {groups.map((g) => (
        <div className="tgroup" key={g.id}>
          <span className="tglabel lbl">{g.label}</span>
          {g.qs.map((q) => <Tile key={q.id} q={q} />)}
        </div>
      ))}
      {!groups.length && <div className="tile note muted">no quotes</div>}
    </div>
  );
}

const Ticker = memo(TickerBase);
export default Ticker;
