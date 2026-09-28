"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, Search, X } from "lucide-react";
import type { IntelSnapshot } from "@/lib/intel-types";
import type { LaneId } from "@/lib/types";
import { GAZETTEER } from "@/lib/gazetteer";
import {
  GROUP_LABEL, INDICATORS, INDICATOR_BY_ID,
  type CountryData, type IndicatorDef, type IndicatorGroup, type IndicatorSeries, type ScreenerData, type ScreenerRow, type SeriesPoint,
} from "@/lib/country-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { COMPARE_MAX, LANE_BY_ID, LANE_CLASS, fold, relativeTime, useMediaQuery, type ViewItem } from "./util";
import LineChart, { type ChartSeries, type RefLine } from "./charts/LineChart";

export interface CountryViewProps {
  snapshot: IntelSnapshot | null;
  items: Map<string, ViewItem>;
  /** ISO2 upper case, or null when no country is selected. */
  selected: string | null;
  onSelect: (iso2: string | null) => void;
  /** ISO2 upper case, at most COMPARE_MAX. */
  compare: string[];
  onCompare: (list: string[]) => void;
  theme: "dark" | "light";
  window: string;
  onSearch: (q: string) => void;
  /** "News" button: the parent keeps the country filter and switches to the lanes view. */
  onShowNews?: (iso2: string) => void;
  /** Persisted card tab (prefs.countryTab); unknown values fall back to the overview. */
  tab?: string;
  onTab?: (tab: string) => void;
}

/* ------------------------------------------------------------------ constants */

const TABS = ["overview", "economy", "energy", "power", "industry", "trade", "governance", "compare", "screener"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview", economy: "Economy", energy: "Energy", power: "Power", industry: "Industry", trade: "Trade",
  governance: "Governance", compare: "Compare", screener: "Screener",
};
const GROUPS: IndicatorGroup[] = ["economy", "energy", "power", "industry", "trade", "governance"];
const isTab = (t: unknown): t is Tab => typeof t === "string" && (TABS as readonly string[]).includes(t);
const isGroup = (t: string): t is IndicatorGroup => (GROUPS as string[]).includes(t);

/** The twelve most decision-relevant indicators, in tile order. */
export const OVERVIEW_IDS = [
  "gdp", "gdp_growth", "inflation", "current_account", "gov_debt", "fdi",
  "energy_imports", "renewable_share", "elec_renew", "industry_va", "manuf_va", "pol_stability",
];
const COMPARE_IDS = [...OVERVIEW_IDS, "fuel_exports", "elec_coal", "manuf_exports", "lpi", "rule_of_law"];

/** Colour follows the entity: a compared country keeps its palette slot while it stays in the list. */
const PALETTE: Record<"dark" | "light", string[]> = {
  dark: ["#4fa3ff", "#f5b53f", "#43d17a", "#ff6b8a"],
  light: ["#1f66b8", "#9a6407", "#187a43", "#c02c48"],
};
/** The selected country when it is not itself in the compare list. */
const PRIMARY: Record<"dark" | "light", string> = { dark: "#b58cff", light: "#6a45c4" };

const TTL_MS = 3_600_000;
const FETCH_MS = 20_000;
const SPARK_YEARS = 15;
const SCREENER_PAGE = 60;
const TOP_EMPTY = 10;
const TOP_CHIPS = 24;

/* ---------- shared class strings (density conventions from the shell) */

const LBL = "text-[11px] tracking-[0.08em] text-muted-foreground uppercase";
const NOTE = "text-[11px] text-muted-foreground";
const MONO = "font-mono tabular-nums";
const TH = "h-7 px-2 text-right text-[10.5px] font-normal tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase";
const TH_LEFT = cn(TH, "text-left");
const TD = "px-2 py-1 text-right whitespace-nowrap tabular-nums max-[859px]:py-1.5";
const TD_LEFT = cn(TD, "text-left");
const TD_MONO = cn(TD, "font-mono");
const TABLE_WRAP = "max-w-full overflow-x-auto rounded-md border bg-card";
const LINK_BTN = "h-auto px-1 py-0 text-[11px] font-normal text-primary hover:bg-transparent hover:underline";
/* the viewport's inner div is display:table by default, which breaks width in a flex column */
const SCROLL = "min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!";

const laneDot = (lane: LaneId | null | undefined, extra?: string | false) =>
  cn("inline-block size-[7px] shrink-0 rounded-full", lane ? LANE_CLASS[lane].bg : "bg-muted-foreground", extra);

/* ------------------------------------------------------------------ formatting */

/** Abbreviated dollars; `fine` adds a decimal under 10 so neighbouring axis ticks stay distinct. */
function formatUsd(v: number, fine = false): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]];
  for (const [d, u] of units) {
    if (a >= d) {
      const n = a / d;
      const digits = n >= 100 ? 0 : fine && n < 10 ? 2 : 1;
      return `${sign}$${n.toFixed(digits)}${u}`;
    }
  }
  return `${sign}$${a.toFixed(0)}`;
}

/** pct: one decimal and %, usd: abbreviated, num: thousands separators, idx: two decimals. */
export function formatValue(v: number | null | undefined, fmt: IndicatorDef["fmt"]): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  switch (fmt) {
    case "pct": return `${v.toFixed(1)}%`;
    case "usd": return formatUsd(v);
    case "idx": return v !== 0 && Math.abs(v) < 0.01 ? v.toFixed(3) : v.toFixed(2);
    default: return v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 });
  }
}

/** Axis ticks: the same rules with trailing zeros dropped. */
export function formatTick(v: number, fmt: IndicatorDef["fmt"]): string {
  if (fmt === "pct") return `${Number(v.toFixed(1))}%`;
  if (fmt === "idx") return String(Number(v.toFixed(2)));
  if (fmt === "usd") return Number.isFinite(v) ? formatUsd(v, true) : "n/a";
  return formatValue(v, fmt);
}

export interface Delta {
  text: string;
  /** Direction of the move. */
  dir: "up" | "down" | "flat";
  /** Whether the move is favourable given the indicator's `better`; "flat" when neutral. */
  good: "up" | "down" | "flat";
}

/** Signed change: percentage points for pct, relative % for usd and num, plain difference for idx. */
export function formatDelta(cur: number | undefined, prev: number | undefined, fmt: IndicatorDef["fmt"], better: IndicatorDef["better"]): Delta | null {
  if (cur === undefined || prev === undefined || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  let d: number;
  let text: string;
  let digits: number;
  if (fmt === "usd" || fmt === "num") {
    if (!prev) return null;
    d = ((cur - prev) / Math.abs(prev)) * 100;
    digits = 1;
    text = `${Math.abs(d).toFixed(digits)}%`;
  } else if (fmt === "pct") {
    d = cur - prev;
    digits = 1;
    text = `${Math.abs(d).toFixed(digits)} pp`;
  } else {
    d = cur - prev;
    digits = 2;
    text = Math.abs(d).toFixed(digits);
  }
  /* the direction follows the rounded text, so a move that prints as 0.0 is flat rather than "-0.0" */
  const rounded = Number(d.toFixed(digits));
  const dir: Delta["dir"] = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const sign = dir === "up" ? "+" : dir === "down" ? "-" : "";
  const good: Delta["good"] = better === "none" || dir === "flat" ? "flat" : better === "up" ? dir : dir === "up" ? "down" : "up";
  return { text: `${sign}${text}`, dir, good };
}

const deltaClass = (d: Delta | null) => (!d ? "text-muted-foreground" : d.good === "up" ? "text-up" : d.good === "down" ? "text-down" : "text-muted-foreground");

/* ------------------------------------------------------------------ series helpers */

function sorted(s: IndicatorSeries): SeriesPoint[] {
  return s.points.filter((p) => Number.isFinite(p.value)).slice().sort((a, b) => a.year - b.year);
}

export function latestOf(s: IndicatorSeries | undefined): SeriesPoint | undefined {
  if (!s) return undefined;
  if (s.latest) return s.latest;
  const pts = sorted(s);
  const actual = pts.filter((p) => !p.est);
  return actual[actual.length - 1] ?? pts[pts.length - 1];
}

export function prevOf(s: IndicatorSeries | undefined): SeriesPoint | undefined {
  if (!s) return undefined;
  if (s.prev) return s.prev;
  const latest = latestOf(s);
  if (!latest) return undefined;
  const before = sorted(s).filter((p) => !p.est && p.year < latest.year);
  return before[before.length - 1];
}

/** Actual value at `year` or the nearest earlier year within two years. */
export function valueAt(s: IndicatorSeries | undefined, year: number): number | undefined {
  if (!s) return undefined;
  const cands = sorted(s).filter((p) => !p.est && p.year <= year && p.year >= year - 2);
  return cands.length ? cands[cands.length - 1].value : undefined;
}

export function fiveYear(s: IndicatorSeries | undefined, def: IndicatorDef): Delta | null {
  const latest = latestOf(s);
  if (!latest) return null;
  return formatDelta(latest.value, valueAt(s, latest.year - 5), def.fmt, def.better);
}

function lastYears(s: IndicatorSeries | undefined, n: number): SeriesPoint[] {
  if (!s) return [];
  const pts = sorted(s);
  return pts.slice(Math.max(0, pts.length - n));
}

const shortDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "unknown date";
};
const errMsg = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" ? "timeout after 20s" : e.message) : "request failed");

/* ------------------------------------------------------------------ session cache */

interface Stored<T> { savedAt: number; data: T }

function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored<T>;
    if (!s || typeof s !== "object" || typeof s.savedAt !== "number" || !s.data) return null;
    if (Date.now() - s.savedAt > TTL_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return s.data;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, data: T) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data } satisfies Stored<T>));
  } catch {
    /* storage may be unavailable or full */
  }
}

interface Entry<T> { status: "loading" | "ok" | "error"; data?: T; error?: string }

/**
 * Fetch-once store: a ref Map for the session, sessionStorage with a one hour TTL across reloads,
 * and a state record so components re-render when an entry lands.
 */
function useStore<T>(url: (key: string) => string, storageKey: (key: string) => string, valid: (d: T) => boolean, cacheable: (d: T) => boolean = () => true) {
  const cache = useRef(new Map<string, T>());
  const inflight = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const [entries, setEntries] = useState<Record<string, Entry<T>>>({});
  /* every in-flight request is aborted when the view unmounts, so nothing lands on a dead component */
  useEffect(() => {
    mounted.current = true;
    const pending = inflight.current;
    return () => {
      mounted.current = false;
      for (const ctrl of pending.values()) ctrl.abort();
      pending.clear();
    };
  }, []);
  const load = useCallback(
    async (key: string, force = false) => {
      if (!force) {
        const c = cache.current.get(key) ?? readSession<T>(storageKey(key));
        if (c && valid(c)) {
          cache.current.set(key, c);
          setEntries((e) => (e[key]?.data === c ? e : { ...e, [key]: { status: "ok", data: c } }));
          return;
        }
      }
      if (inflight.current.has(key)) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), FETCH_MS);
      inflight.current.set(key, ctrl);
      setEntries((e) => ({ ...e, [key]: { status: "loading", data: e[key]?.data } }));
      try {
        const res = await fetch(url(key), { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T;
        if (!valid(data)) throw new Error("unexpected payload");
        cache.current.set(key, data);
        /* an answer with nothing in it is kept for this render only, so a retry or a reload asks the server again */
        if (cacheable(data)) writeSession(storageKey(key), data);
        if (mounted.current) setEntries((e) => ({ ...e, [key]: { status: "ok", data } }));
      } catch (err) {
        /* an unmount abort is not an error to show; a timeout abort is */
        const unmountAbort = ctrl.signal.aborted && !(ctrl.signal.reason instanceof DOMException && ctrl.signal.reason.name === "TimeoutError");
        if (mounted.current && !unmountAbort) setEntries((e) => ({ ...e, [key]: { status: "error", data: e[key]?.data, error: errMsg(err) } }));
      } finally {
        clearTimeout(timer);
        if (inflight.current.get(key) === ctrl) inflight.current.delete(key);
      }
    },
    [url, storageKey, valid, cacheable],
  );
  return { entries, load };
}

const countryUrl = (iso2: string) => `/api/country/${iso2}`;
const countryKey = (iso2: string) => `ww:country:${iso2}`;
const validCountry = (d: CountryData) => !!d && typeof d === "object" && !!d.profile && !!d.series && typeof d.series === "object";
/** Both sources down means the card is empty: not worth an hour in sessionStorage. */
const cacheableCountry = (d: CountryData) => d.sources.wb === "ok" || d.sources.imf === "ok";
const screenerUrl = (ind: string) => `/api/screener?ind=${encodeURIComponent(ind)}`;
const screenerKey = (ind: string) => `ww:screener:${ind}`;
const validScreener = (d: ScreenerData) => !!d && typeof d === "object" && Array.isArray(d.rows);

/* ------------------------------------------------------------------ country list and mentions */

interface CountryRef { iso2: string; label: string; folded: string }

const COUNTRIES: CountryRef[] = GAZETTEER.filter((e) => e.kind === "country" && e.iso2)
  .map((e) => ({ iso2: e.iso2!.toUpperCase(), label: e.label, folded: fold(e.label) }))
  .sort((a, b) => a.label.localeCompare(b.label));
const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso2, c]));

interface Mention { count: number; lane: LaneId | null; itemIds: string[] }

function mentionMap(snapshot: IntelSnapshot | null): Map<string, Mention> {
  const m = new Map<string, Mention>();
  if (!snapshot) return m;
  for (const p of snapshot.points) {
    const iso = p.iso2.toUpperCase();
    const cur = m.get(iso) ?? { count: 0, lane: null, itemIds: [] };
    cur.count += p.count;
    cur.itemIds.push(...p.itemIds);
    let best = cur.lane;
    let bn = -1;
    for (const [lane, n] of Object.entries(p.lanes) as [LaneId, number | undefined][]) {
      if ((n ?? 0) > bn) {
        bn = n ?? 0;
        best = lane;
      }
    }
    cur.lane = best;
    m.set(iso, cur);
  }
  return m;
}

/* ------------------------------------------------------------------ small parts */

/** 40x14 sparkline of the last years, forecast dashed, last actual point marked. */
export function Sparkline({ series, width = 40, height = 14 }: { series: IndicatorSeries | undefined; width?: number; height?: number }) {
  const pts = lastYears(series, SPARK_YEARS);
  /* the inline size beats a parent button's svg sizing rule */
  const size = { width, height };
  if (pts.length < 2) return <svg className="shrink-0 text-muted-foreground" width={width} height={height} style={size} aria-hidden="true" />;
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const x0 = pts[0].year;
  const x1 = pts[pts.length - 1].year;
  const x = (yr: number) => 1 + ((yr - x0) / (x1 - x0 || 1)) * (width - 2);
  const y = (v: number) => (max === min ? height / 2 : 1 + (1 - (v - min) / (max - min)) * (height - 2));
  const path = (arr: SeriesPoint[]) => arr.map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const actual = pts.filter((p) => !p.est);
  const est = pts.filter((p) => p.est);
  const estPath = est.length ? [...(actual.length ? [actual[actual.length - 1]] : []), ...est] : [];
  const last = actual[actual.length - 1];
  return (
    <svg className="shrink-0 text-muted-foreground" width={width} height={height} style={size} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {actual.length > 1 && <path d={path(actual)} className="fill-none stroke-current stroke-[1.25] [stroke-linecap:round] [stroke-linejoin:round]" />}
      {estPath.length > 1 && <path d={path(estPath)} className="fill-none stroke-current stroke-[1.25] [stroke-dasharray:2_2] [stroke-linejoin:round]" />}
      {last && <circle cx={x(last.year)} cy={y(last.value)} r={1.6} className="fill-foreground" />}
    </svg>
  );
}

export interface KpiTileProps {
  def: IndicatorDef;
  series: IndicatorSeries | undefined;
  active?: boolean;
  onOpen?: (id: string) => void;
}

/** Stat tile: label, latest value, year, delta vs previous year coloured by `better`, sparkline, world value. */
export function KpiTile({ def, series, active, onOpen }: KpiTileProps) {
  const latest = latestOf(series);
  const prev = prevOf(series);
  const delta = formatDelta(latest?.value, prev?.value, def.fmt, def.better);
  const aria = latest
    ? `${def.label}: ${formatValue(latest.value, def.fmt)} in ${latest.year}${latest.est ? ", estimate" : ""}${delta ? `, ${delta.text} vs previous` : ""}; open chart`
    : `${def.label}: no data; open chart`;
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-w-0 flex-col items-stretch justify-start gap-0.5 rounded-md p-2 text-left font-normal whitespace-normal aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      onClick={() => onOpen?.(def.id)}
      title={`${def.label} (${def.unit}); click for the full chart`}
      aria-label={aria}
      aria-pressed={!!active}
    >
      <span className="truncate text-[10.5px] text-muted-foreground">{def.short}</span>
      <span className={cn("flex items-baseline gap-1.5 text-base leading-tight font-semibold", MONO)}>
        {latest ? formatValue(latest.value, def.fmt) : <span className="font-normal text-muted-foreground">n/a</span>}
        {latest && <span className="text-[10px] font-normal text-muted-foreground">{latest.year}{latest.est ? "e" : ""}</span>}
      </span>
      <span className="flex min-h-4 items-center justify-between gap-1.5">
        <span className={cn("text-[11px]", MONO, deltaClass(delta))}>{delta ? delta.text : ""}</span>
        <Sparkline series={series} />
      </span>
      <span className={cn("text-[10px] text-muted-foreground", MONO)}>{series?.world !== undefined ? `world ${formatValue(series.world, def.fmt)}` : def.unit}</span>
    </Button>
  );
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="loading country data">
      <Skeleton className="h-3.5 w-2/5" />
      <div className="grid grid-cols-2 gap-1 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
      </div>
    </div>
  );
}

function ErrorCard({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <Card className="items-center gap-2 rounded-md py-6 text-center text-xs text-down shadow-none">
      <p className="px-3">{children}</p>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>retry</Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ chart panel */

interface Source { iso2: string; name: string; data: CountryData | undefined }

interface ChartPanelProps {
  def: IndicatorDef;
  primary: Source;
  others: Source[];
  colorFor: (iso2: string) => string;
  onClose?: () => void;
  title?: boolean;
}

/** Full chart for one indicator: the primary country, the world level and every compared country with data. */
function ChartPanel({ def, primary, others, colorFor, onClose, title = true }: ChartPanelProps) {
  const series: ChartSeries[] = [];
  const push = (s: Source) => {
    const ser = s.data?.series[def.id];
    if (ser && ser.points.length) series.push({ id: s.iso2, label: s.name, color: colorFor(s.iso2), points: ser.points });
  };
  push(primary);
  for (const o of others) if (o.iso2 !== primary.iso2) push(o);
  const world = primary.data?.series[def.id]?.world;
  /* a world total (GDP, population) dwarfs any single country and would flatten the lines, so it stays a note rather than a level */
  let maxAbs = 0;
  for (const s of series) for (const pt of s.points) if (Number.isFinite(pt.value) && Math.abs(pt.value) > maxAbs) maxAbs = Math.abs(pt.value);
  const worldText = world !== undefined ? `world ${formatValue(world, def.fmt)}` : "";
  const worldAsNote = world !== undefined && (def.fmt === "usd" || def.fmt === "num") && Math.abs(world) > 4 * maxAbs;
  const refLines: RefLine[] = world !== undefined && !worldAsNote ? [{ value: world, label: worldText }] : [];
  const pending = others.filter((o) => o.iso2 !== primary.iso2 && !o.data).map((o) => o.iso2);
  return (
    <Card className="min-w-0 gap-0 rounded-md py-0 shadow-none">
      {title && (
        <CardHeader className="flex flex-row items-center gap-2 px-2.5 pt-2 pb-1">
          <span className="font-medium">{def.label}</span>
          <span className={NOTE}>{def.unit}</span>
          <span className="flex-1" />
          {worldAsNote && <span className={cn(NOTE, MONO)}>{worldText}</span>}
          {pending.length > 0 && <span className={NOTE}>loading {pending.join(", ")}</span>}
          {onClose && (
            <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="close chart">
              <X className="size-3.5" />
            </Button>
          )}
        </CardHeader>
      )}
      <CardContent className={cn("px-2.5 pb-2.5", !title && "pt-2.5")}>
        <LineChart
          series={series}
          refLines={refLines}
          height={220}
          format={(v) => formatValue(v, def.fmt)}
          formatTick={(v) => formatTick(v, def.fmt)}
          ariaLabel={`${def.label} over time`}
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ main component */

export default function CountryView(p: CountryViewProps) {
  const { snapshot, items, selected, onSelect, compare, onCompare, theme, onShowNews, onTab } = p;
  const { match: narrow } = useMediaQuery("(max-width: 859px)");
  const [q, setQ] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [localTab, setLocalTab] = useState<Tab>("overview");
  const tab: Tab = isTab(p.tab) ? p.tab : localTab;
  const setTab = useCallback((t: Tab) => {
    setLocalTab(t);
    onTab?.(t);
  }, [onTab]);
  const [chartId, setChartId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const countries = useStore<CountryData>(countryUrl, countryKey, validCountry, cacheableCountry);
  const screener = useStore<ScreenerData>(screenerUrl, screenerKey, validScreener);

  const mentions = useMemo(() => mentionMap(snapshot), [snapshot]);

  /* list: mentioned countries first by count, then the rest alphabetically; the search folds label and iso2 */
  const ranked = useMemo(() => {
    const list = COUNTRIES.slice().sort((a, b) => {
      const ma = mentions.get(a.iso2)?.count ?? 0;
      const mb = mentions.get(b.iso2)?.count ?? 0;
      return mb - ma || a.label.localeCompare(b.label);
    });
    const f = fold(q.trim());
    if (!f) return list;
    return list.filter((c) => c.folded.includes(f) || c.iso2.toLowerCase().startsWith(f));
  }, [mentions, q]);

  /* the selected country loads on selection; compared ones load when the compare tab or a chart needs them */
  useEffect(() => {
    if (selected) void countries.load(selected);
  }, [selected, countries.load]); // eslint-disable-line react-hooks/exhaustive-deps
  const needCompare = tab === "compare" || chartId !== null;
  useEffect(() => {
    if (needCompare) for (const c of compare) void countries.load(c);
  }, [needCompare, compare, countries.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setChartId(null);
  }, [selected, tab]);
  useEffect(() => {
    if (chartId) chartRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [chartId]);

  const colorFor = useCallback(
    (iso2: string) => {
      const i = compare.indexOf(iso2);
      return i >= 0 ? PALETTE[theme][i] : PRIMARY[theme];
    },
    [compare, theme],
  );
  const addCompare = useCallback(
    (iso2: string) => {
      if (compare.includes(iso2) || compare.length >= COMPARE_MAX) return;
      onCompare([...compare, iso2]);
    },
    [compare, onCompare],
  );
  const removeCompare = useCallback((iso2: string) => onCompare(compare.filter((c) => c !== iso2)), [compare, onCompare]);

  const nameOf = useCallback(
    (iso2: string) => countries.entries[iso2]?.data?.profile.name ?? COUNTRY_BY_ISO.get(iso2)?.label ?? iso2,
    [countries.entries],
  );
  const sourceOf = useCallback((iso2: string): Source => ({ iso2, name: nameOf(iso2), data: countries.entries[iso2]?.data }), [countries.entries, nameOf]);

  const pick = useCallback(
    (iso2: string) => {
      onSelect(iso2);
      setRailOpen(false);
      if (tab === "screener" || tab === "compare") setTab("overview");
    },
    [onSelect, tab, setTab],
  );

  /* ---------- rail */
  const inNews = useMemo(() => ranked.filter((c) => (mentions.get(c.iso2)?.count ?? 0) > 0).length, [ranked, mentions]);
  const railList = (
    <ul className="flex flex-col pb-5" aria-label="countries">
      {ranked.map((c) => {
        const m = mentions.get(c.iso2);
        const on = c.iso2 === selected;
        const inCompare = compare.includes(c.iso2);
        return (
          <li key={c.iso2} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-stretch border-b", on ? "bg-accent" : "hover:bg-accent/40")}>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 justify-start gap-1.5 rounded-none px-2.5 py-1 text-xs font-normal hover:bg-transparent"
              onClick={() => pick(c.iso2)}
              aria-pressed={on}
              title={m?.lane ? `${c.label}: mostly ${LANE_BY_ID[m.lane].label}` : c.label}
            >
              <span className={cn("w-6 shrink-0 text-[11px] text-muted-foreground", MONO)}>{c.iso2}</span>
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {m && <Badge variant="secondary" className={cn("h-4 min-w-5 px-1 text-[10px] font-normal text-primary", MONO)}>{m.count}</Badge>}
              <span className={laneDot(m?.lane, !m && "opacity-25")} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("h-auto w-7 rounded-none border-l text-muted-foreground hover:text-foreground", inCompare && "text-primary")}
              onClick={() => (inCompare ? removeCompare(c.iso2) : addCompare(c.iso2))}
              disabled={!inCompare && compare.length >= COMPARE_MAX}
              aria-label={inCompare ? `remove ${c.label} from compare` : `add ${c.label} to compare`}
              title={inCompare ? "remove from compare" : compare.length >= COMPARE_MAX ? `compare holds ${COMPARE_MAX} countries` : "add to compare"}
            >
              {inCompare ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
            </Button>
          </li>
        );
      })}
      {ranked.length === 0 && <li className="p-2.5 text-xs text-muted-foreground">no country matches</li>}
    </ul>
  );
  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="text"
        className="h-8 pl-7 text-xs md:text-xs"
        placeholder="find a country"
        aria-label="find a country by name or ISO code"
        value={q}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ranked[0]) pick(ranked[0].iso2);
          if (e.key === "Escape") setQ("");
        }}
      />
    </div>
  );

  /* ---------- card state */
  const entry = selected ? countries.entries[selected] : undefined;
  const data = entry?.data;
  const mention = selected ? mentions.get(selected) : undefined;
  const headlines = useMemo(() => {
    if (!mention) return [];
    const out: ViewItem[] = [];
    const seen = new Set<string>();
    for (const id of mention.itemIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const it = items.get(id);
      if (it) out.push(it);
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 6);
  }, [mention, items]);

  const chartDef = chartId ? INDICATOR_BY_ID[chartId] : undefined;
  const chartBlock = selected && chartDef && (
    <div ref={chartRef}>
      <ChartPanel def={chartDef} primary={sourceOf(selected)} others={compare.map(sourceOf)} colorFor={colorFor} onClose={() => setChartId(null)} />
    </div>
  );

  const renderHeader = () => {
    if (!selected) return null;
    const ref = COUNTRY_BY_ISO.get(selected);
    const prof = data?.profile;
    const n = mention?.count ?? 0;
    const status = !data
      ? null
      : data.mock
        ? "sample data"
        : `World Bank + IMF WEO, updated ${shortDate(data.generatedAt)}`;
    const srcName = (k: "wb" | "imf") => (k === "wb" ? "World Bank" : "IMF");
    const failed = data ? (["wb", "imf"] as const).filter((k) => data.sources[k] === "failed") : [];
    /* diagnostics reported by the route for a source that did not fail outright (partial answers, retries) */
    const noted = data ? (["wb", "imf"] as const).filter((k) => data.errors?.[k] && !failed.includes(k)) : [];
    const fallback = data?.fallback?.length ? data.fallback.length : 0;
    return (
      <header className="border-b bg-card px-3.5 pt-2.5 pb-2 max-[859px]:px-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-base leading-[1.3] font-semibold">{prof?.name ?? ref?.label ?? selected}</h2>
          <Badge variant="outline" className={cn("h-5 px-1.5 text-xs font-normal text-muted-foreground", MONO)}>{selected}</Badge>
          {prof?.iso3 && <Badge variant="secondary" className={cn("h-5 px-1.5 text-[11px] font-normal text-muted-foreground", MONO)}>{prof.iso3}</Badge>}
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px] max-[859px]:h-8"
            onClick={() => addCompare(selected)}
            disabled={compare.includes(selected) || compare.length >= COMPARE_MAX}
            title={compare.includes(selected) ? "already in compare" : "add to the compare list"}
          >
            Compare +
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-[11px] max-[859px]:h-8"
            onClick={() => { p.onSearch(""); onShowNews?.(selected); }}
            title="show this country's headlines in the lanes view"
          >
            News{n ? ` (${n})` : ""}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground max-[859px]:size-8" onClick={() => onSelect(null)} aria-label="close card">
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          {prof?.region && <span>{prof.region}</span>}
          {prof?.incomeLevel && <span>{prof.incomeLevel}</span>}
          {prof?.capital && <span>capital {prof.capital}</span>}
          <span className={cn(n && "text-primary")}>
            {n} headline{n === 1 ? "" : "s"} in {p.window}
          </span>
        </div>
        {status && (
          <div className={cn("mt-1", NOTE)}>
            {status}
            {data && data.missing.length > 0 && <span> · {data.missing.length} of {INDICATORS.length} indicators missing</span>}
            {failed.length > 0 && (
              <span className="text-down" title={failed.map((f) => `${srcName(f)}: ${data?.errors?.[f] ?? "failed"}`).join("\n")}>
                {" "}· {failed.map((f) => `${srcName(f)}${data?.errors?.[f] ? ` (${data.errors[f]})` : ""}`).join(" and ")} unavailable
              </span>
            )}
            {noted.map((k) => (
              <span key={k} className="text-down"> · {srcName(k)}: {data?.errors?.[k]}</span>
            ))}
            {fallback > 0 && (
              <span title={data?.fallback?.map((id) => INDICATOR_BY_ID[id]?.label ?? id).join(", ")}>
                {" "}· IMF unavailable, World Bank history shown (no projections)
              </span>
            )}
            {failed.length > 0 && entry?.status !== "loading" && (
              <Button type="button" variant="link" size="sm" className={cn(LINK_BTN, "ml-1 underline")} onClick={() => void countries.load(selected, true)}>retry</Button>
            )}
            {failed.length > 0 && entry?.status === "loading" && <span> · retrying</span>}
          </div>
        )}
      </header>
    );
  };

  const renderOverview = () => {
    if (!data) return null;
    return (
      <>
        <div className="grid grid-cols-2 gap-1 md:grid-cols-3 xl:grid-cols-5">
          {OVERVIEW_IDS.map((id) => (
            <KpiTile key={id} def={INDICATOR_BY_ID[id]} series={data.series[id]} active={chartId === id} onOpen={setChartId} />
          ))}
        </div>
        {chartBlock}
        {headlines.length > 0 && (
          <section className="border-t pt-2" aria-label="latest headlines">
            <div className="mb-1.5 flex items-center justify-between">
              <span className={LBL}>In the news</span>
              <Button type="button" variant="link" size="sm" className={LINK_BTN} onClick={() => { p.onSearch(""); onShowNews?.(selected!); }}>all {mention?.count ?? 0} in lanes</Button>
            </div>
            <ul className="flex flex-col gap-1">
              {headlines.map((h) => (
                <li key={h.id} className="grid grid-cols-[7px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 text-xs leading-[1.35]">
                  <span className={laneDot(h.lane, "relative -top-px")} aria-hidden="true" />
                  <a href={h.link} target="_blank" rel="noopener noreferrer" className="line-clamp-2 hover:underline">{h.title}</a>
                  <span className="col-start-2 text-[11px] text-muted-foreground">{h.source} · <span className={MONO}>{relativeTime(h.ts, Date.now())}</span></span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  };

  const renderGroup = (group: IndicatorGroup) => {
    if (!data) return null;
    const defs = INDICATORS.filter((d) => d.group === group);
    return (
      <>
        <div className={TABLE_WRAP}>
          <Table className="text-xs">
            <TableHeader className="sticky top-0 z-[1] bg-card">
              <TableRow>
                <TableHead className={TH_LEFT}>Indicator</TableHead>
                <TableHead className={TH}>Latest</TableHead>
                <TableHead className={TH}>Year</TableHead>
                <TableHead className={TH}>vs prev</TableHead>
                <TableHead className={TH}>5y</TableHead>
                <TableHead className={TH}>World</TableHead>
                <TableHead className={cn(TH, "w-16")} aria-label="trend" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {defs.map((d) => {
                const s = data.series[d.id];
                const latest = latestOf(s);
                const delta = formatDelta(latest?.value, prevOf(s)?.value, d.fmt, d.better);
                const five = fiveYear(s, d);
                const open = chartId === d.id;
                return (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer"
                    data-state={open ? "selected" : undefined}
                    aria-current={open ? "true" : undefined}
                    onClick={() => setChartId(d.id)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChartId(d.id); } }}
                    aria-label={`${d.label}, open chart`}
                  >
                    <TableCell className={TD_LEFT}>
                      <span className="block">{d.label}</span>
                      <span className="block text-[10.5px] text-muted-foreground">{d.unit}{d.source === "imf" ? " · IMF" : ""}</span>
                    </TableCell>
                    <TableCell className={TD_MONO}>{latest ? formatValue(latest.value, d.fmt) : <span className="text-muted-foreground">n/a</span>}</TableCell>
                    <TableCell className={cn(TD_MONO, "text-muted-foreground")}>{latest ? `${latest.year}${latest.est ? "e" : ""}` : ""}</TableCell>
                    <TableCell className={cn(TD_MONO, deltaClass(delta))}>{delta?.text ?? ""}</TableCell>
                    <TableCell className={cn(TD_MONO, deltaClass(five))}>{five?.text ?? ""}</TableCell>
                    <TableCell className={cn(TD_MONO, "text-muted-foreground")}>{s?.world !== undefined ? formatValue(s.world, d.fmt) : ""}</TableCell>
                    <TableCell className={cn(TD, "w-16")}><Sparkline series={s} width={56} height={16} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {chartBlock}
      </>
    );
  };

  const renderBody = () => {
    if (!selected) return null;
    if (tab === "screener") return <ScreenerTab store={screener} mentions={mentions} onPick={pick} selected={selected} />;
    if (tab === "compare") {
      return (
        <CompareTab selected={selected} compare={compare} sourceOf={sourceOf} entries={countries.entries} colorFor={colorFor} onRemove={removeCompare} onClear={() => onCompare([])} onRetry={(iso) => void countries.load(iso, true)} onPick={pick} />
      );
    }
    if (entry?.status === "error" && !data) {
      return <ErrorCard onRetry={() => void countries.load(selected, true)}>could not load {nameOf(selected)}: {entry.error}</ErrorCard>;
    }
    if (!data) return <CardSkeleton />;
    return (
      <>
        {entry?.status === "error" && (
          <div className="flex items-center gap-2 text-[11.5px] text-down">
            showing cached data, refresh failed: {entry.error}
            <Button type="button" variant="link" size="sm" className={LINK_BTN} onClick={() => void countries.load(selected, true)}>retry</Button>
          </div>
        )}
        {tab === "overview" ? renderOverview() : isGroup(tab) ? renderGroup(tab) : null}
      </>
    );
  };

  const topChip = (c: CountryRef, extra?: string) => {
    const m = mentions.get(c.iso2);
    return (
      <Button
        key={c.iso2}
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-7 gap-1.5 rounded-full px-2.5 text-[11.5px] font-normal max-[859px]:h-8", c.iso2 === selected && "bg-accent", extra)}
        onClick={() => pick(c.iso2)}
        aria-pressed={c.iso2 === selected}
        title={m?.lane ? `${c.label}: mostly ${LANE_BY_ID[m.lane].label}` : c.label}
      >
        <span className={laneDot(m?.lane, !m && "opacity-25")} aria-hidden="true" />
        <span className={cn("text-muted-foreground", MONO)}>{c.iso2}</span> {c.label}
        {m && <span className={cn("text-[10px] text-primary", MONO)}>{m.count}</span>}
      </Button>
    );
  };

  return (
    <div className={cn("min-w-0 flex-1 bg-background", narrow ? "flex min-h-[60dvh] flex-col" : "grid min-h-0 grid-cols-[240px_minmax(0,1fr)]")}>
      {narrow ? (
        <>
          <div className="flex flex-col gap-1.5 border-b bg-card px-3 py-1.5">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setRailOpen(true)} aria-expanded={railOpen} aria-haspopup="dialog">
                Countries · {inNews}
                {railOpen ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
              </Button>
              <span className={NOTE}>{inNews} in the news · {p.window}</span>
              {compare.length > 0 && (
                <Button type="button" variant="link" size="sm" className={cn(LINK_BTN, "ml-auto")} onClick={() => setTab("compare")}>compare {compare.length}</Button>
              )}
            </div>
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-1.5 pb-2" aria-label="countries in the news">
                {ranked.slice(0, TOP_CHIPS).map((c) => topChip(c, "shrink-0"))}
                {ranked.length === 0 && <span className="text-xs text-muted-foreground">no country matches</span>}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <Sheet open={railOpen} onOpenChange={setRailOpen}>
            <SheetContent side="left" className="w-[280px] gap-0 p-0" aria-label="country list">
              <SheetHeader className="border-b px-3 py-2.5">
                <SheetTitle className={LBL}>Countries</SheetTitle>
                <SheetDescription className="text-[11px]">{inNews} in the news · {p.window}</SheetDescription>
              </SheetHeader>
              <div className="px-3 pt-2 pb-1.5">{searchBox}</div>
              <ScrollArea className={SCROLL}>{railList}</ScrollArea>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <aside className="flex min-h-0 flex-col border-r bg-card" aria-label="country list">
          <div className="px-2.5 pt-2 pb-1.5">{searchBox}</div>
          <div className={cn("flex items-center justify-between gap-1.5 px-2.5 pb-1.5", NOTE)}>
            <span>{inNews} in the news · {p.window}</span>
            {compare.length > 0 && (
              <Button type="button" variant="link" size="sm" className={LINK_BTN} onClick={() => setTab("compare")}>compare {compare.length}</Button>
            )}
          </div>
          <ScrollArea className={SCROLL}>{railList}</ScrollArea>
        </aside>
      )}

      <section className={cn("flex min-w-0 flex-col", narrow ? "overflow-visible" : "min-h-0 overflow-y-auto")} aria-label="country card">
        {!selected ? (
          <div className="m-auto w-full max-w-[620px] px-4 py-8 text-center text-xs leading-[1.5] max-[859px]:px-3 max-[859px]:py-6">
            <p className="mb-1 text-[15px] font-semibold">pick a country</p>
            <p className="text-muted-foreground">Ratios from the World Bank and the IMF WEO, their evolution, peers to compare and a screener across countries.</p>
            <div className="my-3.5 mb-2.5 flex flex-wrap justify-center gap-1.5">
              {ranked.slice(0, TOP_EMPTY).map((c) => topChip(c))}
            </div>
            {tab === "screener" && (
              <div className="mt-3.5 text-left">
                <ScreenerTab store={screener} mentions={mentions} onPick={pick} selected={null} />
              </div>
            )}
            {tab !== "screener" && (
              <Button type="button" variant="link" size="sm" className={LINK_BTN} onClick={() => setTab("screener")}>or open the screener</Button>
            )}
          </div>
        ) : (
          <article className="flex min-w-0 flex-col">
            {renderHeader()}
            <Tabs value={tab} onValueChange={(v) => { if (isTab(v)) setTab(v); }} className="min-w-0 gap-0">
              <TabsList
                aria-label="card sections"
                className={cn("h-9 w-full justify-start overflow-x-auto rounded-none border-b bg-card p-0 [scrollbar-width:none]", !narrow && "sticky top-0 z-[2]")}
              >
                {TABS.map((t) => (
                  <TabsTrigger
                    key={t}
                    value={t}
                    className="h-full flex-none gap-1.5 rounded-none border-0 border-b-2 border-transparent px-3 text-[11.5px] font-normal text-muted-foreground data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-b-primary dark:data-[state=active]:bg-transparent"
                  >
                    {TAB_LABEL[t]}
                    {t === "compare" && compare.length > 0 && <span className={cn("text-[10px] text-primary", MONO)}>{compare.length}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={tab} className="flex min-w-0 flex-col gap-3 px-3.5 pt-2.5 pb-6 max-[859px]:px-3">
                {renderBody()}
              </TabsContent>
            </Tabs>
          </article>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ compare tab */

interface CompareTabProps {
  selected: string;
  compare: string[];
  sourceOf: (iso2: string) => Source;
  entries: Record<string, Entry<CountryData>>;
  colorFor: (iso2: string) => string;
  onRemove: (iso2: string) => void;
  onClear: () => void;
  onRetry: (iso2: string) => void;
  onPick: (iso2: string) => void;
}

function CompareTab({ selected, compare, sourceOf, entries, colorFor, onRemove, onClear, onRetry, onPick }: CompareTabProps) {
  const [ind, setInd] = useState("gdp_growth");
  const cols = useMemo(() => [selected, ...compare.filter((c) => c !== selected)].map(sourceOf), [selected, compare, sourceOf]);
  const def = INDICATOR_BY_ID[ind] ?? INDICATOR_BY_ID.gdp_growth;
  return (
    <div className="flex flex-col gap-3">
      <div className={TABLE_WRAP}>
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-[1] bg-card">
            <TableRow>
              <TableHead className={TH_LEFT}>
                <span className="flex items-baseline justify-between gap-1.5">
                  <span>Indicator</span>
                  {compare.length > 0 && <Button type="button" variant="ghost" size="sm" className={cn(LINK_BTN, "normal-case tracking-normal")} onClick={onClear}>clear</Button>}
                </span>
              </TableHead>
              {cols.map((c) => {
                const e = entries[c.iso2];
                return (
                  <TableHead key={c.iso2} className={cn(TH, "min-w-[110px] normal-case tracking-normal")}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full" style={{ background: colorFor(c.iso2) }} aria-hidden="true" />
                      <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0 text-[11px] font-normal text-foreground hover:bg-transparent hover:underline" onClick={() => onPick(c.iso2)} title={`open ${c.name}`}>{c.name}</Button>
                      {c.iso2 === selected ? (
                        <span className={cn("text-[10px] text-muted-foreground", MONO)}>{c.iso2}</span>
                      ) : (
                        <Button type="button" variant="ghost" size="icon" className="size-5 text-muted-foreground hover:text-foreground" onClick={() => onRemove(c.iso2)} aria-label={`remove ${c.name}`}>
                          <X className="size-3" />
                        </Button>
                      )}
                    </span>
                    {e?.status === "loading" && !e.data && <span className="block text-[10px] text-muted-foreground">loading</span>}
                    {e?.status === "error" && !e.data && (
                      <Button type="button" variant="link" size="sm" className={cn(LINK_BTN, "block text-down")} onClick={() => onRetry(c.iso2)}>failed, retry</Button>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {COMPARE_IDS.map((id) => {
              const d = INDICATOR_BY_ID[id];
              const vals = cols.map((c) => latestOf(c.data?.series[id]));
              let best: number | undefined;
              if (d.better !== "none") {
                for (const v of vals) {
                  if (!v) continue;
                  if (best === undefined || (d.better === "up" ? v.value > best : v.value < best)) best = v.value;
                }
              }
              const open = ind === id;
              return (
                <TableRow
                  key={id}
                  className="cursor-pointer"
                  data-state={open ? "selected" : undefined}
                  onClick={() => setInd(id)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setInd(id); } }}
                  aria-label={`${d.label}, chart below`}
                  aria-current={open ? "true" : undefined}
                >
                  <TableCell className={TD_LEFT}>
                    <span className="block">{d.short}</span>
                    <span className="block text-[10.5px] text-muted-foreground">{d.unit}</span>
                  </TableCell>
                  {vals.map((v, i) => (
                    <TableCell key={cols[i].iso2} className={cn(TD_MONO, v && best !== undefined && v.value === best && "bg-up/10 font-semibold")}>
                      {v ? formatValue(v.value, d.fmt) : <span className="font-normal text-muted-foreground">n/a</span>}
                      {v && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{v.year}{v.est ? "e" : ""}</span>}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {compare.length === 0 && <p className="text-[11.5px] text-muted-foreground">add countries with + in the list, or the Compare button on another card (up to {COMPARE_MAX})</p>}
      <div className="flex items-center gap-2">
        <Label htmlFor="cmp-ind" className={cn(LBL, "font-normal")}>Chart</Label>
        <IndicatorSelect id="cmp-ind" value={def.id} onChange={setInd} />
      </div>
      <ChartPanel def={def} primary={cols[0]} others={cols.slice(1)} colorFor={colorFor} title={false} />
    </div>
  );
}

function IndicatorSelect({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm" className="h-7 max-w-full gap-1 px-2 text-xs max-[859px]:h-8" aria-label="Indicator">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GROUPS.map((g) => (
          <SelectGroup key={g}>
            <SelectLabel className={LBL}>{GROUP_LABEL[g]}</SelectLabel>
            {INDICATORS.filter((d) => d.group === g).map((d) => (
              <SelectItem key={d.id} value={d.id} className="text-xs">{d.label} ({d.unit})</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ screener tab */

interface ScreenerTabProps {
  store: { entries: Record<string, Entry<ScreenerData>>; load: (key: string, force?: boolean) => Promise<void> };
  mentions: Map<string, Mention>;
  onPick: (iso2: string) => void;
  selected: string | null;
}

type SortKey = "value" | "change";

function ScreenerTab({ store, mentions, onPick, selected }: ScreenerTabProps) {
  const [ind, setInd] = useState("gdp_growth");
  const [regions, setRegions] = useState<string[]>([]);
  const [newsOnly, setNewsOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "value", desc: true });
  const [limit, setLimit] = useState(SCREENER_PAGE);
  const def = INDICATOR_BY_ID[ind] ?? INDICATOR_BY_ID.gdp_growth;
  const entry = store.entries[ind];
  const data = entry?.data;

  useEffect(() => {
    void store.load(ind);
    setLimit(SCREENER_PAGE);
  }, [ind, store.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    /* a favourable direction sorts to the top by default */
    setSort({ key: "value", desc: def.better !== "down" });
  }, [def.better, def.id]);

  const allRegions = useMemo(() => Array.from(new Set((data?.rows ?? []).map((r) => r.region).filter(Boolean))).sort(), [data]);

  const change = (r: ScreenerRow): number | undefined => {
    if (r.prev5 === undefined || !Number.isFinite(r.prev5)) return undefined;
    if (def.fmt === "usd" || def.fmt === "num") return r.prev5 ? ((r.value - r.prev5) / Math.abs(r.prev5)) * 100 : undefined;
    return r.value - r.prev5;
  };

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.rows.filter((r) => Number.isFinite(r.value));
    if (regions.length) list = list.filter((r) => regions.includes(r.region));
    if (newsOnly) list = list.filter((r) => (mentions.get(r.iso2.toUpperCase())?.count ?? 0) > 0);
    const key = (r: ScreenerRow) => (sort.key === "value" ? r.value : change(r));
    return list.slice().sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === undefined && kb === undefined) return 0;
      if (ka === undefined) return 1;
      if (kb === undefined) return -1;
      return sort.desc ? kb - ka : ka - kb;
    });
  }, [data, regions, newsOnly, sort, mentions, def.fmt]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxAbs = useMemo(() => rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0), [rows]);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? " ▾" : " ▴") : "");
  const ariaSort = (key: SortKey): "descending" | "ascending" | "none" => (sort.key === key ? (sort.desc ? "descending" : "ascending") : "none");
  const SORT_BTN = "h-auto p-0 text-[10.5px] font-normal tracking-[0.06em] text-muted-foreground uppercase hover:bg-transparent hover:text-foreground";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <IndicatorSelect id="scr-ind" value={def.id} onChange={setInd} />
        <span className="inline-flex items-center gap-1.5">
          <Switch id="scr-news" checked={newsOnly} onCheckedChange={setNewsOnly} title="keep only countries with headlines in the window" />
          <Label htmlFor="scr-news" className="text-xs font-normal">only countries in the news</Label>
        </span>
        <span className="flex-1" />
        {data && (
          <span className={cn(NOTE, MONO)}>
            {rows.length} of {data.rows.length}{data.mock ? " · sample data" : ` · ${shortDate(data.generatedAt)}`}
          </span>
        )}
      </div>
      {allRegions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] font-normal aria-pressed:bg-accent max-[859px]:h-8" aria-pressed={regions.length === 0} onClick={() => setRegions([])}>all regions</Button>
          <ToggleGroup type="multiple" variant="outline" size="sm" value={regions} onValueChange={setRegions} className="flex-wrap gap-1 shadow-none" aria-label="regions">
            {allRegions.map((r) => (
              <ToggleGroupItem key={r} value={r} className="h-7 flex-none rounded-md px-2 text-[11px] font-normal first:rounded-md last:rounded-md data-[variant=outline]:border-l max-[859px]:h-8">
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      {entry?.status === "error" && !data && (
        <ErrorCard onRetry={() => void store.load(ind, true)}>screener failed: {entry.error}</ErrorCard>
      )}
      {!data && entry?.status !== "error" && (
        <div className="flex flex-col gap-1.5" aria-busy="true" aria-label={`loading ${def.label}`}>
          <p className={cn(NOTE, "py-1 text-center")}>loading {def.label}</p>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      )}
      {data && (
        <div className={TABLE_WRAP}>
          <Table className="text-xs">
            <TableHeader className="sticky top-0 z-[1] bg-card">
              <TableRow>
                <TableHead className={cn(TH, "font-mono")}>#</TableHead>
                <TableHead className={TH_LEFT}>Country</TableHead>
                <TableHead className={cn(TH_LEFT, "max-[859px]:hidden")}>Region</TableHead>
                <TableHead className={TH} aria-sort={ariaSort("value")}>
                  <Button type="button" variant="ghost" size="sm" className={SORT_BTN} onClick={() => toggleSort("value")} aria-sort={ariaSort("value")}>
                    {def.short}{arrow("value")}
                  </Button>
                </TableHead>
                <TableHead className={TH}>Year</TableHead>
                <TableHead className={TH} aria-sort={ariaSort("change")}>
                  <Button type="button" variant="ghost" size="sm" className={SORT_BTN} onClick={() => toggleSort("change")} aria-sort={ariaSort("change")}>
                    5y{arrow("change")}
                  </Button>
                </TableHead>
                <TableHead className={cn(TH, "w-[120px] min-w-20 max-[859px]:w-14 max-[859px]:min-w-11")} aria-label="value bar" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((r, i) => {
                const iso = r.iso2.toUpperCase();
                const ch = change(r);
                const d = ch === undefined ? null : formatDelta(r.value, r.prev5, def.fmt, def.better);
                const m = mentions.get(iso);
                return (
                  <TableRow key={r.iso2} className="cursor-pointer" data-state={iso === selected ? "selected" : undefined} onClick={() => onPick(iso)}>
                    <TableCell className={cn(TD_MONO, "text-muted-foreground")}>{i + 1}</TableCell>
                    <TableCell className={TD_LEFT}>
                      <Button type="button" variant="ghost" size="sm" className="h-auto justify-start gap-1.5 px-0 py-0 text-left text-xs font-normal hover:bg-transparent hover:underline" onClick={(e) => { e.stopPropagation(); onPick(iso); }}>
                        <span className={cn("text-muted-foreground", MONO)}>{iso}</span> {r.name}
                        {m && <span className={laneDot(m.lane)} aria-hidden="true" title={`${m.count} headlines`} />}
                      </Button>
                    </TableCell>
                    <TableCell className={cn(TD_LEFT, "max-w-[160px] truncate text-[11px] text-muted-foreground max-[859px]:hidden")}>{r.region}</TableCell>
                    <TableCell className={TD_MONO}>{formatValue(r.value, def.fmt)}</TableCell>
                    <TableCell className={cn(TD_MONO, "text-muted-foreground")}>{r.year}</TableCell>
                    <TableCell className={cn(TD_MONO, deltaClass(d))}>{d?.text ?? ""}</TableCell>
                    <TableCell className={cn(TD, "pr-2.5")}>
                      <div className={cn("h-1 rounded-r-sm bg-primary/70", r.value < 0 && "opacity-50")} style={{ width: `${maxAbs ? (Math.abs(r.value) / maxAbs) * 100 : 0}%` }} aria-hidden="true" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows.length > limit && (
            <Button type="button" variant="ghost" size="sm" className="h-8 w-full rounded-none border-t text-[11px] font-normal text-muted-foreground" onClick={() => setLimit((l) => l + SCREENER_PAGE)}>
              show more ({rows.length - limit} left)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
