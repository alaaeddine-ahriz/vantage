"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SeriesPoint } from "@/lib/country-types";
import { cn } from "@/lib/utils";

/* ---------- utility class strings (the SVG maths below is untouched; only the styling moved to Tailwind) */
const TICK = "fill-muted-foreground font-mono text-[10px] tabular-nums";
const NOTE = "fill-muted-foreground text-[10px]";
const LINE = "fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";
const LINE_REF = "fill-none stroke-current stroke-[1.5] [stroke-dasharray:3_3]";
const KEY = "inline-block w-3 shrink-0 border-t-2 border-current";
const KEY_REF = "inline-block w-3 shrink-0 border-t-2 border-dashed border-muted-foreground";

/** One line on the chart. Colour follows the entity: the caller assigns it and keeps it stable. */
export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: SeriesPoint[];
  /** Drawn dashed in the reference style (used for the world average). */
  reference?: boolean;
}

/** A horizontal reference level, for a single latest value such as the world average. */
export interface RefLine {
  value: number;
  label: string;
}

export interface LineChartProps {
  series: ChartSeries[];
  refLines?: RefLine[];
  /** Total height including the axis band. */
  height?: number;
  /** Formats a value for the tooltip and direct labels. */
  format: (v: number) => string;
  /** Formats an axis tick; defaults to `format`. */
  formatTick?: (v: number) => string;
  forecastLabel?: string;
  ariaLabel?: string;
  /** Width used until the container has been measured (and in static markup). */
  initialWidth?: number;
}

interface Layout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  ticks: number[];
  years: number[];
}

/** Clean tick values (1, 2, 5 steps) spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const TICK_FONT = 6.2;

function useWidth(initial: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function pathFor(pts: SeriesPoint[], x: (y: number) => number, y: (v: number) => number): string {
  let d = "";
  for (let i = 0; i < pts.length; i++) d += `${i ? "L" : "M"}${x(pts[i].year).toFixed(1)} ${y(pts[i].value).toFixed(1)}`;
  return d;
}

/**
 * Single-axis line chart: hairline grid, 2px lines, dashed forecast segments, one crosshair tooltip that lists
 * every series at the hovered year. Arrow keys move the crosshair when the chart has focus.
 */
export default function LineChart({
  series,
  refLines = [],
  height = 220,
  format,
  formatTick,
  forecastLabel = "IMF projection",
  ariaLabel = "line chart",
  initialWidth = 640,
}: LineChartProps) {
  const [box, width] = useWidth(initialWidth);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const tick = formatTick ?? format;

  const layout = useMemo<Layout | null>(() => {
    const years = new Set<number>();
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (!Number.isFinite(p.value)) continue;
        years.add(p.year);
        if (p.value < vmin) vmin = p.value;
        if (p.value > vmax) vmax = p.value;
      }
    }
    for (const r of refLines) {
      if (r.value < vmin) vmin = r.value;
      if (r.value > vmax) vmax = r.value;
    }
    if (!years.size) return null;
    const ys = [...years].sort((a, b) => a - b);
    const ticks = niceTicks(vmin, vmax, 4);
    const labelW = Math.max(...ticks.map((t) => tick(t).length)) * TICK_FONT + 10;
    const left = Math.min(72, Math.max(34, labelW));
    const right = 12;
    const top = 12;
    const bottom = 20;
    return {
      width,
      height,
      left,
      right,
      top,
      bottom,
      x0: ys[0],
      x1: ys.length > 1 ? ys[ys.length - 1] : ys[0] + 1,
      y0: ticks[0],
      y1: ticks[ticks.length - 1],
      ticks,
      years: ys,
    };
  }, [series, refLines, width, height, tick]);

  if (!layout) return <div className="p-5 text-center text-xs text-muted-foreground">no data to chart</div>;

  const L = layout;
  const plotW = Math.max(10, L.width - L.left - L.right);
  const plotH = Math.max(10, L.height - L.top - L.bottom);
  const x = (year: number) => L.left + ((year - L.x0) / (L.x1 - L.x0)) * plotW;
  const y = (v: number) => L.top + plotH - ((v - L.y0) / (L.y1 - L.y0 || 1)) * plotH;

  /* year ticks: roughly one label per 56px */
  const span = L.x1 - L.x0;
  const every = span <= 1 ? 1 : Math.max(1, Math.ceil(span / Math.max(1, Math.floor(plotW / 56))));
  const xTicks: number[] = [];
  for (let yr = Math.ceil(L.x0 / every) * every; yr <= L.x1; yr += every) xTicks.push(yr);
  if (!xTicks.length) xTicks.push(L.x0);

  /* first forecast year across series, for the boundary label */
  let firstEst = Infinity;
  for (const s of series) for (const p of s.points) if (p.est && p.year < firstEst) firstEst = p.year;

  const nearestYear = (px: number): number => {
    const yr = L.x0 + ((px - L.left) / plotW) * (L.x1 - L.x0);
    let best = L.years[0];
    let bd = Infinity;
    for (const yy of L.years) {
      const d = Math.abs(yy - yr);
      if (d < bd) {
        bd = d;
        best = yy;
      }
    }
    return best;
  };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(nearestYear(L.left + ((e.clientX - r.left) / r.width) * plotW));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = hover === null ? L.years.length - 1 : L.years.indexOf(hover);
    const n = Math.min(L.years.length - 1, Math.max(0, i + (e.key === "ArrowLeft" ? -1 : 1)));
    setHover(L.years[n]);
  };

  const hoverRows = hover === null
    ? []
    : series
        .map((s) => ({ s, p: s.points.find((p) => p.year === hover) }))
        .filter((r): r is { s: ChartSeries; p: SeriesPoint } => !!r.p);
  const tipLeft = hover === null ? 0 : x(hover);
  /* the tooltip flips to the left of the crosshair past the middle, so it never leaves the chart box */
  const tipRight = tipLeft > L.left + plotW * 0.5;
  const single = series.length === 1;

  return (
    <div ref={box} className="relative w-full min-w-0">
      <svg
        className="block h-auto max-w-full overflow-visible outline-offset-2"
        width={L.width}
        height={L.height}
        viewBox={`0 0 ${L.width} ${L.height}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <defs>
          <clipPath id={`${uid}-clip`}>
            <rect x={L.left} y={L.top - 6} width={plotW} height={plotH + 12} />
          </clipPath>
        </defs>
        {/* recessive hairline grid and axis ticks */}
        {L.ticks.map((t) => (
          <g key={t}>
            <line className="stroke-border" x1={L.left} x2={L.left + plotW} y1={y(t)} y2={y(t)} />
            <text className={TICK} x={L.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {tick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((yr) => (
          <text key={yr} className={TICK} x={x(yr)} y={L.height - 6} textAnchor="middle">
            {yr}
          </text>
        ))}
        <line className="stroke-border" x1={L.left} x2={L.left + plotW} y1={L.top + plotH} y2={L.top + plotH} />

        {/* forecast boundary */}
        {Number.isFinite(firstEst) && (
          <g>
            <line className="stroke-border" x1={x(firstEst)} x2={x(firstEst)} y1={L.top} y2={L.top + plotH} />
            <text className={NOTE} x={Math.min(x(firstEst) + 4, L.left + plotW - 60)} y={L.top + 2} dominantBaseline="hanging">
              {forecastLabel}
            </text>
          </g>
        )}

        {/* reference levels */}
        {refLines.map((r, i) => (
          <g key={`ref${i}`}>
            <line className="stroke-muted-foreground opacity-80 [stroke-dasharray:3_3]" x1={L.left} x2={L.left + plotW} y1={y(r.value)} y2={y(r.value)} />
            <text className={NOTE} x={L.left + plotW} y={y(r.value) - 3} textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}

        {/* lines: actual solid, forecast dashed from the last actual point */}
        <g clipPath={`url(#${uid}-clip)`}>
          {series.map((s) => {
            const pts = s.points.filter((p) => Number.isFinite(p.value)).sort((a, b) => a.year - b.year);
            const actual = pts.filter((p) => !p.est);
            const est = pts.filter((p) => p.est);
            const estPath = est.length ? [...(actual.length ? [actual[actual.length - 1]] : []), ...est] : [];
            return (
              <g key={s.id} style={{ color: s.color }}>
                {actual.length > 0 && <path d={pathFor(actual, x, y)} className={s.reference ? LINE_REF : LINE} />}
                {actual.length === 1 && est.length === 0 && <circle cx={x(actual[0].year)} cy={y(actual[0].value)} r={4} className="fill-current" />}
                {estPath.length > 1 && <path d={pathFor(estPath, x, y)} className={s.reference ? LINE_REF : cn(LINE, "[stroke-dasharray:4_4]")} />}
              </g>
            );
          })}
        </g>

        {/* selective direct label: the endpoint of a single series */}
        {single && (() => {
          const pts = series[0].points.filter((p) => !p.est && Number.isFinite(p.value)).sort((a, b) => a.year - b.year);
          const last = pts[pts.length - 1];
          if (!last) return null;
          return (
            <text className="fill-foreground font-mono text-[10px] tabular-nums" x={Math.min(x(last.year) + 6, L.left + plotW)} y={y(last.value)} dominantBaseline="middle" textAnchor={x(last.year) > L.left + plotW - 50 ? "end" : "start"} dy={x(last.year) > L.left + plotW - 50 ? -8 : 0}>
              {format(last.value)}
            </text>
          );
        })()}

        {/* crosshair and markers */}
        {hover !== null && (
          <g>
            <line className="stroke-muted-foreground" x1={x(hover)} x2={x(hover)} y1={L.top} y2={L.top + plotH} />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.id} cx={x(p.year)} cy={y(p.value)} r={4} className="pointer-events-none fill-current stroke-background stroke-2" style={{ color: s.color }} />
            ))}
          </g>
        )}
        <rect
          x={L.left}
          y={L.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null && hoverRows.length > 0 && (
        <div className="pointer-events-none absolute top-2 z-[2] min-w-[120px] max-w-[calc(50%-12px)] overflow-hidden rounded-md border bg-popover px-2 py-1 text-xs leading-[1.4] text-popover-foreground shadow-md" style={tipRight ? { right: L.width - tipLeft + 10 } : { left: tipLeft + 10 }} role="status">
          <div className="mb-0.5 font-mono text-[10px] text-muted-foreground">{hover}</div>
          {hoverRows.map(({ s, p }) => (
            <div key={s.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <i className={s.reference ? KEY_REF : KEY} style={{ color: s.color }} aria-hidden="true" />
              <b className="font-mono font-semibold tabular-nums text-foreground">{format(p.value)}</b>
              {p.est && <span className="rounded-sm border px-[3px] text-[9px] tracking-[0.06em] text-muted-foreground uppercase">est</span>}
              <span className="max-w-[160px] truncate text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {series.length + refLines.length >= 2 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 px-0.5 text-xs text-muted-foreground" aria-label="legend">
          {series.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <i className={s.reference ? KEY_REF : KEY} style={{ color: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
          {refLines.map((r, i) => (
            <li key={`r${i}`} className="inline-flex items-center gap-1.5">
              <i className={KEY_REF} aria-hidden="true" />
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
