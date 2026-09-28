import { createElement, useEffect, useState, type ReactNode } from "react";
import type { LaneId, Lang, NewsItem, Quote, QuoteGroup, Region, SourceStatus } from "@/lib/types";
import { LANES, LANGS, REGIONS } from "@/lib/types";
import { SOURCES } from "@/lib/sources";

/** NewsItem enriched at merge time so render loops never parse or fold text. */
export interface Item extends NewsItem {
  /** publishedAt as epoch ms (0 when unparseable). */
  ts: number;
  /** folded title + summary, used by search and watchlist. */
  txt: string;
  /** folded source, publisher and sourceId, used by search. */
  meta: string;
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

export type View = "lanes" | "stream";
export type Theme = "dark" | "light";
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
};

export const REGION_CODE: Record<Region, string> = {
  global: "GL", europe: "EU", france: "FR", mena: "ME", asia: "AS", americas: "AM", africa: "AF",
};

export const STORAGE_KEY = "ww:prefs:v1";
export const REFRESH_MS = 5 * 60_000;
/** Rows rendered per list before a "show more" button. */
export const PAGE = 150;
export const SAVED_MAX = 500;

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

/** Enriches a NewsItem once, at merge time. */
export function toItem(n: NewsItem): Item {
  const ts = Date.parse(n.publishedAt);
  return {
    ...n,
    ts: Number.isFinite(ts) ? ts : 0,
    txt: fold(`${n.title} ${n.summary ?? ""}`),
    meta: fold(`${n.source} ${n.publisher ?? ""} ${n.sourceId}`),
  };
}

export function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** Case and diacritic insensitive form of a string. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Matcher { re: RegExp; reG: RegExp }

/** Terms of 3 characters or fewer match on word boundaries, longer ones as substrings. */
export function buildMatcher(terms: string[]): Matcher | null {
  const parts = terms
    .map((t) => fold(t.trim()))
    .filter(Boolean)
    .map((t) => (t.length <= 3 ? `\\b${escapeRe(t)}\\b` : escapeRe(t)));
  if (!parts.length) return null;
  const src = `(?:${parts.join("|")})`;
  return { re: new RegExp(src, "i"), reG: new RegExp(src, "gi") };
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

function pickIds<T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!isStrArr(v)) return fallback;
  return v.filter((x): x is T => (allowed as readonly string[]).includes(x));
}

export function sanitizePrefs(raw: unknown): Prefs {
  const d = DEFAULT_PREFS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const saved = Array.isArray(r.saved)
    ? (r.saved as unknown[])
        .filter((s): s is NewsItem => !!s && typeof s === "object" && typeof (s as NewsItem).id === "string" && typeof (s as NewsItem).title === "string" && typeof (s as NewsItem).link === "string")
        .slice(0, SAVED_MAX)
    : d.saved;
  return {
    watchlist: isStrArr(r.watchlist) ? r.watchlist.slice(0, 200) : d.watchlist,
    saved,
    view: r.view === "stream" ? "stream" : "lanes",
    window: WINDOWS.some((w) => w.id === r.window) ? (r.window as WindowId) : d.window,
    lanes: pickIds(r.lanes, LANES.map((l) => l.id), d.lanes),
    regions: pickIds(r.regions, REGIONS.map((x) => x.id), d.regions),
    langs: pickIds(r.langs, LANGS.map((x) => x.id), d.langs),
    disabledSources: isStrArr(r.disabledSources) ? r.disabledSources : d.disabledSources,
    watchOnly: r.watchOnly === true,
    theme: r.theme === "light" ? "light" : "dark",
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
  const esc = (s: string | undefined) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["publishedAt", "title", "source", "publisher", "region", "lang", "lane", "link", "summary"];
  const rows = items.map((i) => [i.publishedAt, i.title, i.source, i.publisher, i.region, i.lang, i.lane, i.link, i.summary].map(esc).join(","));
  download(`world-watchout-saved-${stamp()}.csv`, [head.join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8");
}

export function exportMd(items: NewsItem[]) {
  const lines = [`# World Watchout: saved items`, ``, `Exported ${new Date().toISOString()} (${items.length} items)`, ``];
  for (const i of items) {
    const who = i.publisher ? `${i.publisher} via ${i.source}` : i.source;
    lines.push(`- [${i.title.replace(/[[\]]/g, " ")}](${i.link}) (${who}, ${i.publishedAt.slice(0, 16).replace("T", " ")} UTC, ${i.lane})`);
  }
  download(`world-watchout-saved-${stamp()}.md`, lines.join("\n") + "\n", "text/markdown;charset=utf-8");
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
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
