"use client";

import { memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Quote } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatPct, formatPrice, GROUP_CLASS, QUOTE_GROUPS } from "./util";

const SPARK_W = 42;
const SPARK_H = 20;

/** Up to six closes: a line plus a soft fill under it, so the shape reads at a glance. */
function Spark({ series }: { series?: number[] }) {
  const pts = (series ?? []).filter((v) => Number.isFinite(v)).slice(-6);
  if (pts.length < 2) return <span className="block w-[42px] shrink-0" aria-hidden="true" />;
  const min = Math.min(...pts);
  const span = Math.max(...pts) - min || 1;
  const x = (i: number) => ((i / (pts.length - 1)) * (SPARK_W - 2) + 1).toFixed(1);
  const y = (v: number) => (SPARK_H - 2 - ((v - min) / span) * (SPARK_H - 4)).toFixed(1);
  const coords = pts.map((v, i) => `${x(i)},${y(v)}`);
  const line = coords.join(" ");
  const area = `M${x(0)},${SPARK_H - 1} L${coords.join(" L")} L${x(pts.length - 1)},${SPARK_H - 1} Z`;
  return (
    <svg className="block shrink-0" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true">
      <path d={area} fill="currentColor" opacity="0.14" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="1.6" fill="currentColor" />
    </svg>
  );
}

const dirOf = (pct: number | null) => (pct === null || !Number.isFinite(pct) || pct === 0 ? "flat" : pct > 0 ? "up" : "down");
const DIR_CLASS = { up: "text-up", down: "text-down", flat: "text-muted-foreground" } as const;

function Tile({ q, group }: { q: Quote; group?: string }) {
  const dir = dirOf(q.changePct);
  /* unit already names the currency (USD/bbl, EUR/MWh); only bare instruments fall back to the provider currency. */
  const unit = q.unit ?? q.currency ?? "";
  const title = [q.label, unit, q.symbol, q.note ?? `provider: ${q.provider}`, q.time ? `as of ${q.time}` : ""].filter(Boolean).join(" | ");
  const gc = GROUP_CLASS[q.group];
  return (
    <div
      className={cn(
        "flex h-11 min-w-0 items-center gap-1.5 border-t-2 bg-card pr-2 pl-2.5 max-[1179px]:w-40 max-[1179px]:flex-none max-[1179px]:border-r",
        gc.border,
        group && "pl-1.5",
      )}
      title={title}
    >
      {/* the first tile of a group carries the group name as a small vertical strip, so no cell is wasted on a label */}
      {group && (
        <span className={cn("max-h-full shrink-0 overflow-hidden rotate-180 text-[8px] leading-none font-semibold tracking-[0.1em] uppercase [writing-mode:vertical-rl]", gc.text)} aria-hidden="true">
          {group}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5 overflow-hidden text-[10.5px] leading-[1.25] whitespace-nowrap text-muted-foreground">
          <span className="max-w-full shrink-0 truncate text-foreground">{q.label}</span>
          {unit && <span className="ml-auto min-w-0 truncate text-[9.5px]">{unit}</span>}
        </div>
        <div className="flex items-baseline gap-1.5 font-mono text-[12.5px] leading-[1.2] tabular-nums whitespace-nowrap">
          <span className={cn(q.price === null && "text-muted-foreground")}>{formatPrice(q)}</span>
          <span className={cn("text-[11px]", DIR_CLASS[dir])}>{formatPct(q.changePct)}</span>
        </div>
      </div>
      <span className={DIR_CLASS[dir]}>
        <Spark series={q.series} />
      </span>
    </div>
  );
}

export interface TickerProps {
  quotes: Quote[] | null;
  error: boolean;
  open: boolean;
  onToggle: () => void;
}

/* Radix renders the viewport's child as display:table, which would grow to fit a non-wrapping row; block keeps the grid at the strip's width. */
const VIEWPORT_BLOCK = "[&>[data-slot=scroll-area-viewport]>div]:block!";

function TickerBase({ quotes, error, open, onToggle }: TickerProps) {
  const groups = quotes ? QUOTE_GROUPS.map((g) => ({ ...g, qs: quotes.filter((q) => q.group === g.id) })).filter((g) => g.qs.length) : [];
  const n = quotes?.length ?? 0;
  const note = !quotes ? (error ? "markets unavailable" : "loading markets") : error ? "stale" : !n ? "no quotes" : "";
  const noteEl = note && (
    <span className={cn("text-[9.5px]", error ? "text-down" : "text-muted-foreground")} title={error ? "Last refresh of market data failed" : undefined}>
      {note}
    </span>
  );

  if (!open) {
    return (
      <div className="flex min-h-[26px] items-stretch border-b bg-card max-[859px]:min-h-[30px]" aria-label="Market quotes (collapsed)">
        <Button
          type="button"
          variant="ghost"
          className="h-auto shrink-0 gap-1.5 rounded-none border-r bg-secondary px-2 py-0 text-[9.5px] tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground"
          aria-expanded={false}
          aria-controls="ticker-body"
          onClick={onToggle}
          title="Expand markets"
        >
          <ChevronRight className="size-3" aria-hidden="true" />
          Markets
          {n > 0 && <span className="font-mono text-[9.5px] tracking-normal tabular-nums">{n}</span>}
          {noteEl}
        </Button>
        <ScrollArea id="ticker-body" className={cn("min-w-0 flex-1", VIEWPORT_BLOCK)}>
          <div className="flex w-max items-center text-[11px] leading-[26px] whitespace-nowrap">
            {groups.map((g) => (
              <span className="inline-flex items-center" key={g.id}>
                <span className="border-r bg-secondary px-2 text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">{g.label}</span>
                {g.qs.map((q) => {
                  const dir = dirOf(q.changePct);
                  return (
                    <span className="inline-flex items-baseline gap-1 border-r px-2 text-muted-foreground" key={q.id} title={`${q.label} ${q.unit ?? q.currency ?? ""}`.trim()}>
                      {q.label} <b className="font-mono font-medium text-foreground tabular-nums">{formatPrice(q)}</b>{" "}
                      <span className={cn("font-mono text-[10.5px] tabular-nums", DIR_CLASS[dir])}>{formatPct(q.changePct)}</span>
                    </span>
                  );
                })}
              </span>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="h-1.5" />
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex items-stretch border-b bg-card" aria-label="Market quotes">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-[30px] shrink-0 flex-col gap-1 rounded-none border-r bg-secondary px-0 py-1 text-muted-foreground hover:text-foreground max-[1179px]:w-[22px]"
        aria-expanded={true}
        aria-controls="ticker-body"
        onClick={onToggle}
        title="Collapse markets"
      >
        <ChevronDown className="size-3" aria-hidden="true" />
        {/* one row is only 44px tall at tablet width: the fold button keeps its chevron and drops the vertical label */}
        <span className="rotate-180 text-[9.5px] tracking-[0.14em] uppercase [writing-mode:vertical-rl] max-[1179px]:hidden">Markets</span>
        {n > 0 && <span className="font-mono text-[9.5px] tabular-nums max-[1179px]:hidden">{n}</span>}
        {noteEl && <span className="rotate-180 [writing-mode:vertical-rl] max-[1179px]:hidden">{noteEl}</span>}
      </Button>
      <ScrollArea id="ticker-body" className={cn("min-w-0 flex-1", VIEWPORT_BLOCK)}>
        {/* three rows at most on desktop; one sideways-scrolling row below 1180px */}
        <div className="flex w-max min-[1180px]:grid min-[1180px]:max-h-[134px] min-[1180px]:w-auto min-[1180px]:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] min-[1180px]:auto-rows-[44px] min-[1180px]:gap-px min-[1180px]:overflow-hidden min-[1180px]:bg-border">
          {groups.map((g) => g.qs.map((q, i) => <Tile key={q.id} q={q} group={i === 0 ? g.label : undefined} />))}
        </div>
        <ScrollBar orientation="horizontal" className="h-1.5 min-[1180px]:hidden" />
      </ScrollArea>
    </div>
  );
}

const Ticker = memo(TickerBase);
export default Ticker;
