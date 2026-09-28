"use client";

import { memo } from "react";
import type { Quote } from "@/lib/types";
import { formatPct, formatPrice, QUOTE_GROUPS } from "./util";

const SPARK_W = 42;
const SPARK_H = 20;

/** Up to six closes: a line plus a soft fill under it, so the shape reads at a glance. */
function Spark({ series }: { series?: number[] }) {
  const pts = (series ?? []).filter((v) => Number.isFinite(v)).slice(-6);
  if (pts.length < 2) return <span className="spark none" aria-hidden="true" />;
  const min = Math.min(...pts);
  const span = Math.max(...pts) - min || 1;
  const x = (i: number) => ((i / (pts.length - 1)) * (SPARK_W - 2) + 1).toFixed(1);
  const y = (v: number) => (SPARK_H - 2 - ((v - min) / span) * (SPARK_H - 4)).toFixed(1);
  const coords = pts.map((v, i) => `${x(i)},${y(v)}`);
  const line = coords.join(" ");
  const area = `M${x(0)},${SPARK_H - 1} L${coords.join(" L")} L${x(pts.length - 1)},${SPARK_H - 1} Z`;
  return (
    <svg className="spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true">
      <path d={area} fill="currentColor" opacity="0.14" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="1.6" fill="currentColor" />
    </svg>
  );
}

const dirOf = (pct: number | null) => (pct === null || !Number.isFinite(pct) || pct === 0 ? "flat" : pct > 0 ? "up" : "down");

function Tile({ q, group }: { q: Quote; group?: string }) {
  const dir = dirOf(q.changePct);
  /* unit already names the currency (USD/bbl, EUR/MWh); only bare instruments fall back to the provider currency. */
  const unit = q.unit ?? q.currency ?? "";
  const title = [q.label, unit, q.symbol, q.note ?? `provider: ${q.provider}`, q.time ? `as of ${q.time}` : ""].filter(Boolean).join(" | ");
  return (
    <div className={`tile dir-${dir} g-${q.group}${group ? " lead" : ""}`} title={title}>
      {/* the first tile of a group carries the group name as a vertical strip, so no cell is wasted on a label */}
      {group && <span className="tg" aria-hidden="true">{group}</span>}
      <div className="tt">
        <div className="tl">
          <span className="tn">{q.label}</span>
          {unit && <span className="tu">{unit}</span>}
        </div>
        <div className="tv">
          <span className={`px${q.price === null ? " muted" : ""}`}>{formatPrice(q)}</span>
          <span className="tp">{formatPct(q.changePct)}</span>
        </div>
      </div>
      <Spark series={q.series} />
    </div>
  );
}

export interface TickerProps {
  quotes: Quote[] | null;
  error: boolean;
  open: boolean;
  onToggle: () => void;
}

function TickerBase({ quotes, error, open, onToggle }: TickerProps) {
  const groups = quotes ? QUOTE_GROUPS.map((g) => ({ ...g, qs: quotes.filter((q) => q.group === g.id) })).filter((g) => g.qs.length) : [];
  const n = quotes?.length ?? 0;
  const note = !quotes ? (error ? "markets unavailable" : "loading markets") : error ? "stale" : !n ? "no quotes" : "";
  const toggle = (
    <button
      type="button"
      className="plain tbtn"
      aria-expanded={open}
      aria-controls="ticker-body"
      onClick={onToggle}
      title={open ? "Collapse markets" : "Expand markets"}
    >
      <span className="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      <span className="lbl">Markets</span>
      {n > 0 && <span className="cnt">{n}</span>}
      {note && <span className={`tnote${error ? " down" : ""}`} title={error ? "Last refresh of market data failed" : undefined}>{note}</span>}
    </button>
  );

  if (!open) {
    return (
      <div className="ticker off" aria-label="Market quotes (collapsed)">
        {toggle}
        <div className="tmini" id="ticker-body">
          {groups.map((g) => (
            <span className="tmg" key={g.id}>
              <span className="tglabel">{g.label}</span>
              {g.qs.map((q) => {
                const dir = dirOf(q.changePct);
                return (
                  <span className={`tq dir-${dir}`} key={q.id} title={`${q.label} ${q.unit ?? q.currency ?? ""}`.trim()}>
                    {q.label} <b className="mono">{formatPrice(q)}</b> <span className="tp mono">{formatPct(q.changePct)}</span>
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ticker" aria-label="Market quotes">
      {toggle}
      <div className="tgrid" id="ticker-body">
        {groups.map((g) => g.qs.map((q, i) => <Tile key={q.id} q={q} group={i === 0 ? g.label : undefined} />))}
      </div>
    </div>
  );
}

const Ticker = memo(TickerBase);
export default Ticker;
