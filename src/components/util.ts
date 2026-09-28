import { createElement, useEffect, useState, type ReactNode } from "react";
import type { LaneId, Lang, NewsItem, Quote, QuoteGroup, Region, SourceStatus } from "@/lib/types";
import { LANES, LANGS, REGIONS } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { pickModel } from "@/lib/brief";

/** NewsItem enriched at merge time so render loops never parse or fold text. */
export interface Item extends NewsItem {
  /** publishedAt as epoch ms (0 when unparseable). */
  ts: number;
  /** folded title + summary, used by search and watchlist. */
  txt: string;
  /** folded source, publisher and sourceId, used by search. */
  meta: string;
  /** normalised title key, used to drop the same headline arriving through two feeds. */
  key: string;
}

/** Per-dimension item counts for the current window and search. */
export interface Counts {
  lane: Record<string, number>;
  region: Record<string, number>;
  lang: Record<string, number>;
  src: Record<string, number>;
}

export interface Health {
  ok: number;
  failed: number;
  pending: number;
  failedList: SourceStatus[];
}

export type View = "lanes" | "stream" | "globe" | "graph" | "intel" | "countries";
export const VIEWS: { id: View; label: string }[] = [
  { id: "lanes", label: "Lanes" },
  { id: "stream", label: "Stream" },
  { id: "globe", label: "Globe" },
  { id: "graph", label: "Graph" },
  { id: "intel", label: "Intel" },
  { id: "countries", label: "Countries" },
];
export type Theme = "dark" | "light";

/** Minimal item the globe, graph and intel views resolve ids against. */
export interface ViewItem {
  id: string;
  title: string;
  source: string;
  lane: LaneId;
  ts: number;
  link: string;
}
export type WindowId = "1h" | "6h" | "24h" | "48h" | "7d";

export const WINDOWS: { id: WindowId; ms: number }[] = [
  { id: "1h", ms: 3_600_000 },
  { id: "6h", ms: 6 * 3_600_000 },
  { id: "24h", ms: 24 * 3_600_000 },
  { id: "48h", ms: 48 * 3_600_000 },
  { id: "7d", ms: 7 * 24 * 3_600_000 },
];

export interface Prefs {
  watchlist: string[];
  saved: NewsItem[];
  view: View;
  window: WindowId;
  lanes: LaneId[];
  regions: Region[];
  langs: Lang[];
  disabledSources: string[];
  watchOnly: boolean;
  theme: Theme;
  /** Countries overlaid on the country card, ISO2 upper case, at most COMPARE_MAX. */
  compare: string[];
  /** Model id for the AI brief; validated against BRIEF_MODELS. */
  briefModel: string;
  /** Last tab opened on the country card. */
  countryTab?: string;
  /** Ids of collapsed panels and sections (see PANEL_IDS); everything else is open. */
  collapsed: string[];
}

export const DEFAULT_WATCHLIST = [
  "OPEC", "LNG", "TTF", "TotalEnergies", "EU ETS", "tariff", "hydrogen", "nuclear",
  "ArcelorMittal", "Siemens Energy", "Aramco", "copper",
];

export const DEFAULT_PREFS: Prefs = {
  watchlist: DEFAULT_WATCHLIST,
  saved: [],
  view: "lanes",
  window: "24h",
  lanes: LANES.map((l) => l.id),
  regions: REGIONS.map((r) => r.id),
  langs: LANGS.map((l) => l.id),
  disabledSources: [],
  watchOnly: false,
  theme: "dark",
  compare: [],
  briefModel: "claude-opus-5",
  collapsed: ["sources"],
};

/** Every panel or section that can be folded; unknown ids are dropped from stored prefs. */
export const PANEL_IDS = [
  "ticker", "sidebar", "right",
  "window", "lanes", "regions", "langs", "sources",
  "watchlist", "saved", "health",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const REGION_CODE: Record<Region, string> = {
  global: "GL", europe: "EU", france: "FR", mena: "ME", asia: "AS", americas: "AM", africa: "AF",
};

export const STORAGE_KEY = "ww:prefs:v1";
export const REFRESH_MS = 5 * 60_000;
/** Rows rendered per list before a "show more" button. */
export const PAGE = 150;
export const SAVED_MAX = 500;
export const WATCHLIST_MAX = 200;
export const COMPARE_MAX = 4;
/** Requests that hang longer than this are abandoned so the refresh cycle keeps running. */
export const FETCH_TIMEOUT_MS = 45_000;

export const LANE_BY_ID = Object.fromEntries(LANES.map((l) => [l.id, l])) as Record<LaneId, (typeof LANES)[number]>;
export const REGION_LABEL = Object.fromEntries(REGIONS.map((r) => [r.id, r.label])) as Record<Region, string>;

export const QUOTE_GROUPS: { id: QuoteGroup; label: string }[] = [
  { id: "energy", label: "Energy" },
  { id: "metals", label: "Metals" },
  { id: "fx", label: "FX" },
  { id: "indices", label: "Indices" },
  { id: "rates", label: "Rates" },
];

export const WIRE_SOURCES = new Set(SOURCES.filter((s) => s.kind === "gnews").map((s) => s.id));

/** Google News wires re-carry publisher headlines; they lose against the direct feed when deduplicating. */
export const isWire = (sourceId: string) => WIRE_SOURCES.has(sourceId) || sourceId.startsWith("gn-");

/**
 * Normalised title key: NFD, diacritics stripped, lowercased, non alphanumerics squashed to one space,
 * trimmed and capped at 90 characters. Mirrors the server-side key so both agree when both exist.
 */
export function localTitleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 90);
}

/** Enriches a NewsItem once, at merge time. */
export function toItem(n: NewsItem): Item {
  const ts = Date.parse(n.publishedAt);
  /* the server may ship a precomputed key; the cast keeps this compiling whether or not the field exists yet */
  const serverKey = (n as NewsItem & { key?: string }).key;
  return {
    ...n,
    ts: Number.isFinite(ts) ? ts : 0,
    txt: fold(`${n.title} ${n.summary ?? ""}`),
    meta: fold(`${n.source} ${n.publisher ?? ""} ${n.sourceId}`),
    key: typeof serverKey === "string" && serverKey ? serverKey : localTitleKey(n.title),
  };
}

export function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** Case and diacritic insensitive form of a string. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/* Only regex syntax characters are escaped: under the u flag an identity escape of anything else is a SyntaxError. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Matcher { re: RegExp; reG: RegExp }

/* Unicode-aware boundaries: a term must start where no letter, digit or underscore precedes it. */
const WORD_START = "(?<![\\p{L}\\p{N}_])";
const WORD_END = "(?![\\p{L}\\p{N}_])";

/**
 * Every term matches at a word start, so "OPEC" no longer lights up inside "Sinopec" while "tariff" still
 * matches "tariffs" and "LNG" matches "LNG-fuelled". Terms of 3 characters or fewer also need a trailing
 * boundary so "TTF" does not match "ttfx". Input is escaped so "S&P", "C++" or "(" never throw.
 */
export function buildMatcher(terms: string[]): Matcher | null {
  const parts = terms
    .map((t) => fold(t.trim()))
    .filter(Boolean)
    .map((t) => `${WORD_START}${escapeRe(t)}${t.length <= 3 ? WORD_END : ""}`);
  if (!parts.length) return null;
  const src = `(?:${parts.join("|")})`;
  try {
    return { re: new RegExp(src, "iu"), reG: new RegExp(src, "giu") };
  } catch {
    return null;
  }
}

export function matchesWatch(m: Matcher | null, foldedText: string): boolean {
  return m !== null && m.re.test(foldedText);
}

/** Wraps matches in <mark> by splitting the original text into React nodes. */
export function highlight(text: string, m: Matcher | null): ReactNode {
  if (!m) return text;
  let f = "";
  const idx: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const fc = fold(text[i]);
    for (let k = 0; k < fc.length; k++) idx.push(i);
    f += fc;
  }
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  m.reG.lastIndex = 0;
  let mt: RegExpExecArray | null;
  while ((mt = m.reG.exec(f)) !== null) {
    if (mt[0].length === 0) { m.reG.lastIndex++; continue; }
    const s = idx[mt.index];
    const e = idx[mt.index + mt[0].length - 1] + 1;
    if (s > last) out.push(text.slice(last, s));
    out.push(createElement("mark", { key: n++ }, text.slice(s, e)));
    last = e;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface SearchQuery { words: string[]; lanes: string[]; srcs: string[] }

export function parseSearch(s: string): SearchQuery | null {
  const q: SearchQuery = { words: [], lanes: [], srcs: [] };
  for (const raw of s.split(/\s+/)) {
    const t = fold(raw);
    if (!t) continue;
    if (t.startsWith("lane:")) q.lanes.push(t.slice(5));
    else if (t.startsWith("src:")) q.srcs.push(t.slice(4));
    else q.words.push(t);
  }
  return q.words.length || q.lanes.length || q.srcs.length ? q : null;
}

export function matchesSearch(it: Item, q: SearchQuery | null): boolean {
  if (!q) return true;
  for (const w of q.words) if (!it.txt.includes(w) && !it.meta.includes(w)) return false;
  for (const l of q.lanes) if (!it.lanes.some((x) => x.startsWith(l)) && !it.lane.startsWith(l)) return false;
  for (const s of q.srcs) if (!it.sourceId.includes(s) && !it.meta.includes(s)) return false;
  return true;
}

export function relativeTime(ts: number, now: number): string {
  if (!ts) return "n/a";
  const m = Math.floor(Math.max(0, now - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function absoluteTime(ts: number): string {
  return ts ? new Date(ts).toLocaleString() : "unknown time";
}

export function utcClock(ms: number, seconds = true): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return seconds ? `${hm}:${p(d.getUTCSeconds())}` : hm;
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function priceDecimals(q: Quote): number {
  if (q.group === "fx") return 4;
  if (q.group === "energy" && /gas|ttf|ng=|nbp|henry|jkm/i.test(`${q.id} ${q.symbol} ${q.label}`)) return 3;
  return 2;
}

export function formatPrice(q: Quote): string {
  if (q.price === null || !Number.isFinite(q.price)) return "n/a";
  const d = priceDecimals(q);
  return q.price.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function formatPct(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "n/a";
  const sign = p > 0 ? "+" : p < 0 ? "-" : "";
  return `${sign}${Math.abs(p).toFixed(2)}%`;
}

export function toNewsItem(it: NewsItem): NewsItem {
  const { id, title, link, summary, publishedAt, sourceId, source, publisher, region, lang, lanes, lane } = it;
  return { id, title, link, summary, publishedAt, sourceId, source, publisher, region, lang, lanes, lane };
}

function isStrArr(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

const LANE_IDS = LANES.map((l) => l.id);
const REGION_IDS = REGIONS.map((r) => r.id);
const LANG_IDS = LANGS.map((l) => l.id);

function pickId<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function pickIds<T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!isStrArr(v)) return fallback;
  return v.filter((x): x is T => (allowed as readonly string[]).includes(x));
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Every field of a stored item is normalised so exports and rows never meet a missing string. */
function sanitizeSaved(v: unknown): NewsItem[] {
  if (!Array.isArray(v)) return [];
  const out: NewsItem[] = [];
  const ids = new Set<string>();
  for (const s of v as unknown[]) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.title !== "string" || typeof o.link !== "string") continue;
    if (!o.id || ids.has(o.id)) continue;
    ids.add(o.id);
    const lane = pickId(o.lane, LANE_IDS, "markets");
    const lanes = pickIds(o.lanes, LANE_IDS, [lane]);
    out.push({
      id: o.id,
      title: o.title,
      link: o.link,
      summary: str(o.summary),
      publishedAt: str(o.publishedAt),
      sourceId: str(o.sourceId),
      source: str(o.source, "unknown source"),
      publisher: typeof o.publisher === "string" && o.publisher ? o.publisher : undefined,
      region: pickId(o.region, REGION_IDS, "global"),
      lang: pickId(o.lang, LANG_IDS, "en"),
      lanes: lanes.length ? lanes : [lane],
      lane,
    });
    if (out.length >= SAVED_MAX) break;
  }
  return out;
}

/** Trims, drops blanks and folds away duplicates ("Opec" and "OPEC" are one term). */
function sanitizeWatchlist(v: unknown, fallback: string[]): string[] {
  if (!isStrArr(v)) return fallback;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const t = raw.trim();
    const f = fold(t);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(t);
    if (out.length >= WATCHLIST_MAX) break;
  }
  return out;
}

/** Upper-case ISO2 codes, deduplicated, capped. */
export function sanitizeCompare(v: unknown): string[] {
  if (!isStrArr(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const c = raw.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(c) && !out.includes(c)) out.push(c);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

export function sanitizePrefs(raw: unknown): Prefs {
  const d = DEFAULT_PREFS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  return {
    watchlist: sanitizeWatchlist(r.watchlist, d.watchlist),
    saved: sanitizeSaved(r.saved),
    view: VIEWS.some((v) => v.id === r.view) ? (r.view as View) : "lanes",
    window: WINDOWS.some((w) => w.id === r.window) ? (r.window as WindowId) : d.window,
    lanes: pickIds(r.lanes, LANE_IDS, d.lanes),
    regions: pickIds(r.regions, REGION_IDS, d.regions),
    langs: pickIds(r.langs, LANG_IDS, d.langs),
    disabledSources: isStrArr(r.disabledSources) ? Array.from(new Set(r.disabledSources)) : d.disabledSources,
    watchOnly: r.watchOnly === true,
    theme: r.theme === "light" ? "light" : "dark",
    compare: sanitizeCompare(r.compare),
    briefModel: pickModel(r.briefModel),
    collapsed: Array.from(new Set(pickIds(r.collapsed, PANEL_IDS, d.collapsed))),
    ...(typeof r.countryTab === "string" && r.countryTab ? { countryTab: r.countryTab } : {}),
  };
}

/** localStorage access, only ever called from effects or handlers. */
export function loadPrefs(): Prefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable (private mode, quota) */
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

export function exportCsv(items: NewsItem[]) {
  /* a leading = + - @ tab or CR would be run as a formula by Excel and Sheets; a quote prefix neutralises it */
  const esc = (s: string | undefined) => {
    let v = String(s ?? "");
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return `"${v.replace(/"/g, '""')}"`;
  };
  const head = ["publishedAt", "title", "source", "publisher", "region", "lang", "lane", "link", "summary"];
  const rows = items.map((i) => [i.publishedAt, i.title, i.source, i.publisher, i.region, i.lang, i.lane, i.link, i.summary].map(esc).join(","));
  download(`vantage-saved-${stamp()}.csv`, [head.join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8");
}

export function exportMd(items: NewsItem[]) {
  const lines = [`# Vantage: saved items`, ``, `Exported ${new Date().toISOString()} (${items.length} items)`, ``];
  for (const i of items) {
    const who = i.publisher ? `${i.publisher} via ${i.source}` : i.source;
    const when = (i.publishedAt || "").slice(0, 16).replace("T", " ");
    lines.push(`- [${i.title.replace(/[[\]]/g, " ")}](${i.link}) (${who}, ${when || "unknown time"} UTC, ${i.lane})`);
  }
  download(`vantage-saved-${stamp()}.md`, lines.join("\n") + "\n", "text/markdown;charset=utf-8");
}

export interface MediaQueryState {
  match: boolean;
  /** false until the query has been evaluated in the browser (always false during SSR and hydration). */
  known: boolean;
}

/** Hydration-safe media query: `match` is false and `known` is false until the first effect runs. */
export function useMediaQuery(query: string): MediaQueryState {
  const [state, setState] = useState<MediaQueryState>({ match: false, known: false });
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setState({ match: mq.matches, known: true });
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return state;
}

/** Epoch ms that ticks every `every` ms after mount (0 during SSR). */
export function useNow(every: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}

/* Tailwind only generates classes it can read verbatim from the source, so lane and quote group
 * colours are looked up in static maps instead of being built from ids at render time. */
export const LANE_CLASS: Record<LaneId, { bg: string; text: string; border: string }> = {
  oilgas: { bg: "bg-lane-oilgas", text: "text-lane-oilgas", border: "border-lane-oilgas" },
  power: { bg: "bg-lane-power", text: "text-lane-power", border: "border-lane-power" },
  renewables: { bg: "bg-lane-renewables", text: "text-lane-renewables", border: "border-lane-renewables" },
  industry: { bg: "bg-lane-industry", text: "text-lane-industry", border: "border-lane-industry" },
  policy: { bg: "bg-lane-policy", text: "text-lane-policy", border: "border-lane-policy" },
  markets: { bg: "bg-lane-markets", text: "text-lane-markets", border: "border-lane-markets" },
};

export const GROUP_CLASS: Record<QuoteGroup, { text: string; border: string }> = {
  energy: { text: "text-lane-oilgas", border: "border-t-lane-oilgas" },
  metals: { text: "text-lane-industry", border: "border-t-lane-industry" },
  fx: { text: "text-lane-power", border: "border-t-lane-power" },
  indices: { text: "text-lane-markets", border: "border-t-lane-markets" },
  rates: { text: "text-lane-policy", border: "border-t-lane-policy" },
};
