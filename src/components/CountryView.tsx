"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntelSnapshot } from "@/lib/intel-types";
import type { LaneId } from "@/lib/types";
import { GAZETTEER } from "@/lib/gazetteer";
import {
  GROUP_LABEL, INDICATORS, INDICATOR_BY_ID,
  type CountryData, type IndicatorDef, type IndicatorGroup, type IndicatorSeries, type ScreenerData, type ScreenerRow, type SeriesPoint,
} from "@/lib/country-types";
import { COMPARE_MAX, LANE_BY_ID, fold, relativeTime, useMediaQuery, type ViewItem } from "./util";
import LineChart, { type ChartSeries, type RefLine } from "./charts/LineChart";
import css from "./CountryView.module.css";

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

const deltaClass = (d: Delta | null) => (!d ? css.dflat : d.good === "up" ? css.dup : d.good === "down" ? css.ddown : css.dflat);

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
  if (pts.length < 2) return <svg className={css.spark} width={width} height={height} aria-hidden="true" />;
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
    <svg className={css.spark} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {actual.length > 1 && <path d={path(actual)} className={css.sparkLine} />}
      {estPath.length > 1 && <path d={path(estPath)} className={css.sparkEst} />}
      {last && <circle cx={x(last.year)} cy={y(last.value)} r={1.6} className={css.sparkDot} />}
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
    <button type="button" className={`${css.tile} ${active ? css.tileOn : ""}`} onClick={() => onOpen?.(def.id)} title={`${def.label} (${def.unit}); click for the full chart`} aria-label={aria} aria-pressed={!!active}>
      <span className={css.tileLabel}>{def.short}</span>
      <span className={css.tileValue}>
        {latest ? formatValue(latest.value, def.fmt) : <span className={css.na}>n/a</span>}
        {latest && <span className={css.tileYear}>{latest.year}{latest.est ? "e" : ""}</span>}
      </span>
      <span className={css.tileFoot}>
        <span className={`${css.delta} ${deltaClass(delta)}`}>{delta ? delta.text : ""}</span>
        <Sparkline series={series} />
      </span>
      <span className={css.tileWorld}>{series?.world !== undefined ? `world ${formatValue(series.world, def.fmt)}` : def.unit}</span>
    </button>
  );
}

function Skeleton() {
  return (
    <div className={css.skeleton} aria-busy="true" aria-label="loading country data">
      <div className={css.skHead} />
      <div className={css.skGrid}>
        {Array.from({ length: 12 }, (_, i) => <div key={i} className={css.skTile} />)}
      </div>
    </div>
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
    <div className={css.chart}>
      {title && (
        <div className={css.chartHead}>
          <span className={css.chartTitle}>{def.label}</span>
          <span className={css.chartUnit}>{def.unit}</span>
          <span className={css.spacer} />
          {worldAsNote && <span className={`${css.chartNote} mono`}>{worldText}</span>}
          {pending.length > 0 && <span className={css.chartNote}>loading {pending.join(", ")}</span>}
          {onClose && (
            <button type="button" className="plain" onClick={onClose} aria-label="close chart">x</button>
          )}
        </div>
      )}
      <LineChart
        series={series}
        refLines={refLines}
        height={220}
        format={(v) => formatValue(v, def.fmt)}
        formatTick={(v) => formatTick(v, def.fmt)}
        ariaLabel={`${def.label} over time`}
      />
    </div>
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
  const rows = narrow ? ranked.slice(0, TOP_CHIPS) : ranked;
  const inNews = useMemo(() => ranked.filter((c) => (mentions.get(c.iso2)?.count ?? 0) > 0).length, [ranked, mentions]);
  const railList = (
    <ul className={narrow ? css.chipRow : css.list} aria-label="countries">
      {rows.map((c) => {
        const m = mentions.get(c.iso2);
        const on = c.iso2 === selected;
        const inCompare = compare.includes(c.iso2);
        return (
          <li key={c.iso2} className={`${css.item} ${on ? css.itemOn : ""} ${m?.lane ? `lc-${m.lane}` : ""}`}>
            <button type="button" className={css.itemBtn} onClick={() => pick(c.iso2)} aria-pressed={on} title={m?.lane ? `${c.label}: mostly ${LANE_BY_ID[m.lane].label}` : c.label}>
              <span className={`${css.iso} mono`}>{c.iso2}</span>
              <span className={css.name}>{c.label}</span>
              <span className={`${css.count} mono`}>{m?.count ?? ""}</span>
              <i className={`dot ${m ? "" : css.dotOff}`} aria-hidden="true" />
            </button>
            {!narrow && (
              <button
                type="button"
                className={`${css.plus} ${inCompare ? css.plusOn : ""}`}
                onClick={() => (inCompare ? removeCompare(c.iso2) : addCompare(c.iso2))}
                disabled={!inCompare && compare.length >= COMPARE_MAX}
                aria-label={inCompare ? `remove ${c.label} from compare` : `add ${c.label} to compare`}
                title={inCompare ? "remove from compare" : compare.length >= COMPARE_MAX ? `compare holds ${COMPARE_MAX} countries` : "add to compare"}
              >
                {inCompare ? "-" : "+"}
              </button>
            )}
          </li>
        );
      })}
      {rows.length === 0 && <li className={css.none}>no country matches</li>}
    </ul>
  );
  const searchBox = (
    <input
      type="text"
      className={css.search}
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
    const failed = data ? (["wb", "imf"] as const).filter((k) => data.sources[k] === "failed") : [];
    return (
      <header className={css.head}>
        <div className={css.headTop}>
          <h2 className={css.title}>{prof?.name ?? ref?.label ?? selected}</h2>
          <span className={`${css.iso2} mono`}>{selected}</span>
          {prof?.iso3 && <span className={`${css.iso3} mono muted`}>{prof.iso3}</span>}
          <span className={css.spacer} />
          <button type="button" className={css.hbtn} onClick={() => addCompare(selected)} disabled={compare.includes(selected) || compare.length >= COMPARE_MAX} title={compare.includes(selected) ? "already in compare" : "add to the compare list"}>
            Compare +
          </button>
          <button type="button" className={css.hbtn} onClick={() => { p.onSearch(""); onShowNews?.(selected); }} title="show this country's headlines in the lanes view">
            News{n ? ` (${n})` : ""}
          </button>
          <button type="button" className="plain" onClick={() => onSelect(null)} aria-label="close card">x</button>
        </div>
        <div className={css.headMeta}>
          {prof?.region && <span>{prof.region}</span>}
          {prof?.incomeLevel && <span>{prof.incomeLevel}</span>}
          {prof?.capital && <span>capital {prof.capital}</span>}
          <span className={n ? css.headNews : "muted"}>
            {n} headline{n === 1 ? "" : "s"} in {p.window}
          </span>
        </div>
        {status && (
          <div className={`${css.status} muted`}>
            {status}
            {data && data.missing.length > 0 && <span> · {data.missing.length} of {INDICATORS.length} indicators missing</span>}
            {failed.length > 0 && (
              <span className={css.warn} title={failed.map((f) => `${f === "wb" ? "World Bank" : "IMF"}: ${data?.errors?.[f] ?? "failed"}`).join("\n")}>
                {" "}· {failed.map((f) => `${f === "wb" ? "World Bank" : "IMF"}${data?.errors?.[f] ? ` (${data.errors[f]})` : ""}`).join(" and ")} unavailable
              </span>
            )}
            {failed.length > 0 && entry?.status !== "loading" && (
              <button type="button" className={`plain ${css.retry}`} onClick={() => void countries.load(selected, true)}>retry</button>
            )}
            {failed.length > 0 && entry?.status === "loading" && <span className="muted"> · retrying</span>}
          </div>
        )}
      </header>
    );
  };

  const renderTabs = () => (
    <div className={css.tabs} role="tablist" aria-label="card sections">
      {TABS.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${css.tab} ${tab === t ? css.tabOn : ""}`} onClick={() => setTab(t)}>
          {TAB_LABEL[t]}
          {t === "compare" && compare.length > 0 && <span className={`${css.tabCount} mono`}>{compare.length}</span>}
        </button>
      ))}
    </div>
  );

  const renderOverview = () => {
    if (!data) return null;
    return (
      <>
        <div className={css.grid}>
          {OVERVIEW_IDS.map((id) => (
            <KpiTile key={id} def={INDICATOR_BY_ID[id]} series={data.series[id]} active={chartId === id} onOpen={setChartId} />
          ))}
        </div>
        {chartBlock}
        {headlines.length > 0 && (
          <section className={css.news} aria-label="latest headlines">
            <div className={css.secHead}>
              <span className="lbl">In the news</span>
              <button type="button" className={css.linkBtn} onClick={() => { p.onSearch(""); onShowNews?.(selected!); }}>all {mention?.count ?? 0} in lanes</button>
            </div>
            <ul className={css.newsList}>
              {headlines.map((h) => (
                <li key={h.id} className={`lc-${h.lane}`}>
                  <i className="dot" aria-hidden="true" />
                  <a href={h.link} target="_blank" rel="noopener noreferrer" className={css.newsTitle}>{h.title}</a>
                  <span className={css.newsMeta}>{h.source} · <span className="mono">{relativeTime(h.ts, Date.now())}</span></span>
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
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.thLeft}>Indicator</th>
                <th>Latest</th>
                <th>Year</th>
                <th>vs prev</th>
                <th>5y</th>
                <th>World</th>
                <th aria-label="trend" />
              </tr>
            </thead>
            <tbody>
              {defs.map((d) => {
                const s = data.series[d.id];
                const latest = latestOf(s);
                const delta = formatDelta(latest?.value, prevOf(s)?.value, d.fmt, d.better);
                const five = fiveYear(s, d);
                return (
                  <tr key={d.id} className={`${css.row} ${chartId === d.id ? css.rowOn : ""}`} onClick={() => setChartId(d.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChartId(d.id); } }} aria-label={`${d.label}, open chart`}>
                    <td className={css.thLeft}>
                      <span className={css.rowLabel}>{d.label}</span>
                      <span className={css.rowUnit}>{d.unit}{d.source === "imf" ? " · IMF" : ""}</span>
                    </td>
                    <td className="mono">{latest ? formatValue(latest.value, d.fmt) : <span className={css.na}>n/a</span>}</td>
                    <td className="mono muted">{latest ? `${latest.year}${latest.est ? "e" : ""}` : ""}</td>
                    <td className={`mono ${deltaClass(delta)}`}>{delta?.text ?? ""}</td>
                    <td className={`mono ${deltaClass(five)}`}>{five?.text ?? ""}</td>
                    <td className="mono muted">{s?.world !== undefined ? formatValue(s.world, d.fmt) : ""}</td>
                    <td className={css.tdSpark}><Sparkline series={s} width={56} height={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {chartBlock}
      </>
    );
  };

  return (
    <div className={css.wrap}>
      {narrow ? (
        <div className={css.mobileBar}>
          <button type="button" className={css.mobileToggle} onClick={() => setRailOpen((o) => !o)} aria-expanded={railOpen}>
            <span>Countries</span>
            <span className="cnt">{inNews} in the news</span>
            <span aria-hidden="true">{railOpen ? "▴" : "▾"}</span>
          </button>
          {railOpen && (
            <div className={css.mobileBody}>
              {searchBox}
              {railList}
            </div>
          )}
        </div>
      ) : (
        <aside className={css.rail} aria-label="country list">
          <div className={css.railHead}>{searchBox}</div>
          <div className={css.railNote}>
            <span>{inNews} in the news · {p.window}</span>
            {compare.length > 0 && (
              <button type="button" className={css.linkBtn} onClick={() => setTab("compare")}>compare {compare.length}</button>
            )}
          </div>
          <div className={css.railScroll}>{railList}</div>
        </aside>
      )}

      <section className={css.main} aria-label="country card">
        {!selected ? (
          <div className={css.emptyCard}>
            <p className={css.emptyTitle}>pick a country</p>
            <p className="muted">Ratios from the World Bank and the IMF WEO, their evolution, peers to compare and a screener across countries.</p>
            <div className={css.topBtns}>
              {ranked.slice(0, TOP_EMPTY).map((c) => {
                const m = mentions.get(c.iso2);
                return (
                  <button key={c.iso2} type="button" className={`${css.topBtn} ${m?.lane ? `lc-${m.lane}` : ""}`} onClick={() => pick(c.iso2)}>
                    <i className="dot" aria-hidden="true" />
                    <span className="mono">{c.iso2}</span> {c.label}
                    {m && <span className="cnt">{m.count}</span>}
                  </button>
                );
              })}
            </div>
            {tab === "screener" && (
              <div className={css.emptyScreener}>
                <ScreenerTab store={screener} mentions={mentions} onPick={pick} selected={null} />
              </div>
            )}
            {tab !== "screener" && (
              <button type="button" className={css.linkBtn} onClick={() => setTab("screener")}>or open the screener</button>
            )}
          </div>
        ) : (
          <article className={css.card}>
            {renderHeader()}
            {renderTabs()}
            <div className={css.body}>
              {tab === "screener" ? (
                <ScreenerTab store={screener} mentions={mentions} onPick={pick} selected={selected} />
              ) : tab === "compare" ? (
                <CompareTab selected={selected} compare={compare} sourceOf={sourceOf} entries={countries.entries} colorFor={colorFor} onRemove={removeCompare} onClear={() => onCompare([])} onRetry={(iso) => void countries.load(iso, true)} onPick={pick} />
              ) : entry?.status === "error" && !data ? (
                <div className={css.error}>
                  <p>could not load {nameOf(selected)}: {entry.error}</p>
                  <button type="button" onClick={() => void countries.load(selected, true)}>retry</button>
                </div>
              ) : !data ? (
                <Skeleton />
              ) : (
                <>
                  {entry?.status === "error" && (
                    <div className={css.stale}>
                      showing cached data, refresh failed: {entry.error}
                      <button type="button" className={css.linkBtn} onClick={() => void countries.load(selected, true)}>retry</button>
                    </div>
                  )}
                  {tab === "overview" ? renderOverview() : isGroup(tab) ? renderGroup(tab) : null}
                </>
              )}
            </div>
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
    <div className={css.compare}>
      <div className={css.tableWrap}>
        <table className={`${css.table} ${css.cmpTable}`}>
          <thead>
            <tr>
              <th className={css.thLeft}>
                <span className={css.cmpCorner}>
                  <span>Indicator</span>
                  {compare.length > 0 && <button type="button" className={css.linkBtn} onClick={onClear}>clear</button>}
                </span>
              </th>
              {cols.map((c) => {
                const e = entries[c.iso2];
                return (
                  <th key={c.iso2} className={css.cmpHead}>
                    <span className={css.cmpKey} style={{ background: colorFor(c.iso2) }} aria-hidden="true" />
                    <button type="button" className={css.cmpName} onClick={() => onPick(c.iso2)} title={`open ${c.name}`}>{c.name}</button>
                    {c.iso2 === selected ? (
                      <span className={`${css.cmpSel} mono`}>{c.iso2}</span>
                    ) : (
                      <button type="button" className="plain" onClick={() => onRemove(c.iso2)} aria-label={`remove ${c.name}`}>x</button>
                    )}
                    {e?.status === "loading" && !e.data && <span className={css.cmpNote}>loading</span>}
                    {e?.status === "error" && !e.data && (
                      <button type="button" className={`${css.linkBtn} ${css.warn}`} onClick={() => onRetry(c.iso2)}>failed, retry</button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
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
              return (
                <tr key={id} className={`${css.row} ${ind === id ? css.rowOn : ""}`} onClick={() => setInd(id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setInd(id); } }} aria-label={`${d.label}, chart below`} aria-current={ind === id ? "true" : undefined}>
                  <td className={css.thLeft}>
                    <span className={css.rowLabel}>{d.short}</span>
                    <span className={css.rowUnit}>{d.unit}</span>
                  </td>
                  {vals.map((v, i) => (
                    <td key={cols[i].iso2} className={`mono ${v && best !== undefined && v.value === best ? css.best : ""}`}>
                      {v ? formatValue(v.value, d.fmt) : <span className={css.na}>n/a</span>}
                      {v && <span className={css.cellYear}>{v.year}{v.est ? "e" : ""}</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {compare.length === 0 && <p className={`${css.hint} muted`}>add countries with + in the list, or the Compare button on another card (up to {COMPARE_MAX})</p>}
      <div className={css.chartPick}>
        <label className="lbl" htmlFor="cmp-ind">Chart</label>
        <IndicatorSelect id="cmp-ind" value={def.id} onChange={setInd} />
      </div>
      <ChartPanel def={def} primary={cols[0]} others={cols.slice(1)} colorFor={colorFor} title={false} />
    </div>
  );
}

function IndicatorSelect({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  return (
    <select id={id} className={css.select} value={value} onChange={(e) => onChange(e.target.value)}>
      {GROUPS.map((g) => (
        <optgroup key={g} label={GROUP_LABEL[g]}>
          {INDICATORS.filter((d) => d.group === g).map((d) => (
            <option key={d.id} value={d.id}>{d.label} ({d.unit})</option>
          ))}
        </optgroup>
      ))}
    </select>
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

  return (
    <div className={css.screener}>
      <div className={css.filters}>
        <IndicatorSelect id="scr-ind" value={def.id} onChange={setInd} />
        <button type="button" className="chip" aria-pressed={newsOnly} onClick={() => setNewsOnly((v) => !v)} title="keep only countries with headlines in the window">
          only countries in the news
        </button>
        <span className={css.spacer} />
        {data && (
          <span className={`${css.chartNote} mono`}>
            {rows.length} of {data.rows.length}{data.mock ? " · sample data" : ` · ${shortDate(data.generatedAt)}`}
          </span>
        )}
      </div>
      {allRegions.length > 1 && (
        <div className={css.chips}>
          <button type="button" className="chip" aria-pressed={regions.length === 0} onClick={() => setRegions([])}>all regions</button>
          {allRegions.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={regions.includes(r)} onClick={() => setRegions((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}>
              {r}
            </button>
          ))}
        </div>
      )}
      {entry?.status === "error" && !data && (
        <div className={css.error}>
          <p>screener failed: {entry.error}</p>
          <button type="button" onClick={() => void store.load(ind, true)}>retry</button>
        </div>
      )}
      {!data && entry?.status !== "error" && <div className={css.loading}>loading {def.label}</div>}
      {data && (
        <div className={css.tableWrap}>
          <table className={`${css.table} ${css.scrTable}`}>
            <thead>
              <tr>
                <th className="mono">#</th>
                <th className={css.thLeft}>Country</th>
                <th className={`${css.thLeft} ${css.thRegion}`}>Region</th>
                <th>
                  <button type="button" className={css.sortBtn} onClick={() => toggleSort("value")} aria-sort={sort.key === "value" ? (sort.desc ? "descending" : "ascending") : "none"}>
                    {def.short}{arrow("value")}
                  </button>
                </th>
                <th>Year</th>
                <th>
                  <button type="button" className={css.sortBtn} onClick={() => toggleSort("change")} aria-sort={sort.key === "change" ? (sort.desc ? "descending" : "ascending") : "none"}>
                    5y{arrow("change")}
                  </button>
                </th>
                <th className={css.thBar} aria-label="value bar" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r, i) => {
                const iso = r.iso2.toUpperCase();
                const ch = change(r);
                const d = ch === undefined ? null : formatDelta(r.value, r.prev5, def.fmt, def.better);
                const m = mentions.get(iso);
                return (
                  <tr key={r.iso2} className={`${css.row} ${iso === selected ? css.rowOn : ""}`} onClick={() => onPick(iso)}>
                    <td className="mono muted">{i + 1}</td>
                    <td className={css.thLeft}>
                      <button type="button" className={`${css.scrName} ${m?.lane ? `lc-${m.lane}` : ""}`} onClick={(e) => { e.stopPropagation(); onPick(iso); }}>
                        <span className="mono muted">{iso}</span> {r.name}
                        {m && <i className="dot" aria-hidden="true" title={`${m.count} headlines`} />}
                      </button>
                    </td>
                    <td className={`${css.thLeft} ${css.tdRegion}`}>{r.region}</td>
                    <td className="mono">{formatValue(r.value, def.fmt)}</td>
                    <td className="mono muted">{r.year}</td>
                    <td className={`mono ${deltaClass(d)}`}>{d?.text ?? ""}</td>
                    <td className={css.tdBar}>
                      <i className={`${css.bar} ${r.value < 0 ? css.barNeg : ""}`} style={{ width: `${maxAbs ? (Math.abs(r.value) / maxAbs) * 100 : 0}%` }} aria-hidden="true" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit && (
            <button type="button" className="more" onClick={() => setLimit((l) => l + SCREENER_PAGE)}>
              show more ({rows.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
