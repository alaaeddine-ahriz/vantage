"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FeedsResponse, MarketsResponse, Quote, SourceStatus } from "@/lib/types";
import type { Brief, BriefRequest, GraphLink, GraphNode, IntelSnapshot } from "@/lib/intel-types";
import { buildIntel } from "@/lib/intel";
import { FEED_BATCHES, SOURCES } from "@/lib/sources";
import { cn } from "@/lib/utils";
import TopBar from "./TopBar";
import Ticker from "./Ticker";
import Sidebar from "./Sidebar";
import LaneBoard from "./LaneBoard";
import RightPanel from "./RightPanel";
import IntelPanel, { type BriefState } from "./IntelPanel";
import CountryView from "./CountryView";
import {
  buildMatcher, fold, isWire, loadPrefs, matchesSearch, parseSearch, savePrefs, toItem, toNewsItem, useMediaQuery, useNow,
  DEFAULT_PREFS, FETCH_TIMEOUT_MS, REFRESH_MS, SAVED_MAX, VIEWS, WATCHLIST_MAX, WINDOWS,
  type Counts, type Health, type Item, type Prefs, type View, type ViewItem,
} from "./util";

/* the globe (three.js) and the force graph (canvas) only run in the browser and load on first use */
const Loading = ({ what }: { what: string }) => <div className="m-auto p-6 text-center text-xs text-muted-foreground">loading {what}</div>;
const GlobeView = dynamic(() => import("./GlobeView"), { ssr: false, loading: () => <Loading what="globe" /> });
const GraphView = dynamic(() => import("./GraphView"), { ssr: false, loading: () => <Loading what="graph" /> });

const BRIEF_KEY = "ww:brief:v1";
/** Newest items sent to the brief; the route accepts up to 400. */
const BRIEF_ITEMS = 250;
const BRIEF_TIMEOUT_MS = 110_000;

function loadBrief(): Brief | null {
  try {
    const raw = window.sessionStorage.getItem(BRIEF_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Brief;
    return b && typeof b === "object" && typeof b.headline === "string" && Array.isArray(b.links) ? b : null;
  } catch {
    return null;
  }
}

function saveBrief(b: Brief | null) {
  try {
    if (b) window.sessionStorage.setItem(BRIEF_KEY, JSON.stringify(b));
    else window.sessionStorage.removeItem(BRIEF_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

/** Entity id whose label or alias equals, contains or is contained in the free-text label, else null. */
function resolveEntity(label: string, snapshot: IntelSnapshot): string | null {
  const f = fold(label.trim());
  if (f.length < 2) return null;
  let partial: string | null = null;
  for (const e of Object.values(snapshot.entities)) {
    const names = [fold(e.label), ...e.aliases];
    for (const n of names) {
      if (!n) continue;
      if (n === f) return e.id;
      /* partial matches need 4+ characters so "EU" never lands inside "Reuters" */
      if (!partial && f.length >= 4 && n.length >= 4 && (n.includes(f) || f.includes(n))) partial = e.id;
    }
  }
  return partial;
}

/** Adds the brief's links to the local graph: known labels attach to entity nodes, unknown ones become ai event nodes. */
function mergeBriefIntoGraph(snapshot: IntelSnapshot, brief: Brief | null): IntelSnapshot["graph"] {
  if (!brief || !brief.links.length) return snapshot.graph;
  const nodes = new Map(snapshot.graph.nodes.map((n) => [n.id, n]));
  const links: GraphLink[] = [...snapshot.graph.links];
  /* one link per source, target and kind: a brief that repeats a relation does not stack edges */
  const seen = new Set(links.map((l) => `${l.source}|${l.target}|${l.kind}`));
  const nodeFor = (label: string, itemIds: string[]): string => {
    const eid = resolveEntity(label, snapshot);
    if (eid) {
      if (!nodes.has(eid)) {
        const e = snapshot.entities[eid];
        nodes.set(eid, { id: eid, kind: e.kind, label: e.label, weight: 1, itemIds: [...itemIds], ai: true });
      }
      return eid;
    }
    const id = `ai:${fold(label).replace(/[^a-z0-9]+/g, "-")}`;
    const cur = nodes.get(id);
    if (cur) cur.weight += 1;
    else nodes.set(id, { id, kind: "event", label: label.trim(), weight: 1, itemIds: [...itemIds], ai: true } satisfies GraphNode);
    return id;
  };
  for (const l of brief.links) {
    const source = nodeFor(l.source, l.itemIds);
    const target = nodeFor(l.target, l.itemIds);
    if (source === target) continue;
    const key = `${source}|${target}|${l.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source, target, kind: l.kind, weight: 1, label: l.label, itemIds: l.itemIds, ai: true });
  }
  return { nodes: [...nodes.values()], links };
}

interface Batch {
  data: { items: Item[]; sources: SourceStatus[] } | null;
  error: string | null;
}

const emptyBatches = (): Batch[] => Array.from({ length: FEED_BATCHES }, () => ({ data: null, error: null }));
const errMsg = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : e.message) : "request failed");

export default function Dashboard() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [batches, setBatches] = useState<Batch[]>(emptyBatches);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [firstDone, setFirstDone] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [nextAt, setNextAt] = useState(0);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [graphFocus, setGraphFocus] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefState, setBriefState] = useState<BriefState>("idle");
  const [briefError, setBriefError] = useState<string | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const fresh = useRef<Set<string>>(new Set());
  const inflight = useRef(false);
  const lastStart = useRef(0);
  const { match: narrow, known: layoutKnown } = useMediaQuery("(max-width: 859px)");
  const { match: wide } = useMediaQuery("(min-width: 1180px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tick = useNow(30_000);
  const now = tick || Date.now();

  /* ---------- preferences: read after mount, write on change, apply theme */
  useEffect(() => {
    const p = loadPrefs();
    if (p) setPrefs(p);
    setBrief(loadBrief());
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) savePrefs(prefs);
  }, [prefs, ready]);
  useEffect(() => {
    if (ready) document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme, ready]);

  /* ---------- data */
  /** Resolves true when the batch landed. Sources the server reports as failed keep their previous items. */
  const fetchBatch = useCallback(async (i: number, markNew: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`/api/feeds?batch=${i}&of=${FEED_BATCHES}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FeedsResponse;
      const items = (data.items ?? []).map(toItem);
      const sources = data.sources ?? [];
      for (const it of items) {
        if (seen.current.has(it.id)) continue;
        seen.current.add(it.id);
        if (markNew) fresh.current.add(it.id);
      }
      if (markNew) setNewIds(new Set(fresh.current));
      const failed = new Set(sources.filter((s) => !s.ok).map((s) => s.id));
      setBatches((prev) =>
        prev.map((b, k) => {
          if (k !== i) return b;
          if (!failed.size || !b.data) return { data: { items, sources }, error: null };
          /* a source that failed or timed out this round keeps what it had, so headlines do not blink in and out */
          const ids = new Set(items.map((it) => it.id));
          const kept = b.data.items.filter((it) => failed.has(it.sourceId) && !ids.has(it.id));
          return { data: { items: kept.length ? [...items, ...kept] : items, sources }, error: null };
        }),
      );
      return true;
    } catch (e) {
      const error = errMsg(e);
      /* the headlines stay on the board, but the batch's sources are reported as failed instead of a stale "ok" */
      setBatches((prev) =>
        prev.map((b, k) => {
          if (k !== i) return b;
          const data = b.data
            ? { items: b.data.items, sources: b.data.sources.map((s) => ({ ...s, ok: false, error: `batch: ${error}` })) }
            : null;
          return { data, error };
        }),
      );
      return false;
    }
  }, []);

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MarketsResponse;
      setQuotes(data.quotes ?? []);
      setQuotesError(false);
    } catch {
      setQuotesError(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    const started = Date.now();
    lastStart.current = started;
    const markNew = seen.current.size > 0;
    fresh.current = new Set();
    if (markNew) setNewIds(new Set());
    setLoading(true);
    setNextAt(started + REFRESH_MS);
    const jobs = Array.from({ length: FEED_BATCHES }, (_, i) => fetchBatch(i, markNew));
    const [results] = await Promise.all([Promise.allSettled(jobs), fetchMarkets()]);
    inflight.current = false;
    setLoading(false);
    setFirstDone(true);
    /* the timestamp only moves when at least one batch actually landed */
    if (results.some((r) => r.status === "fulfilled" && r.value)) setUpdatedAt(Date.now());
  }, [fetchBatch, fetchMarkets]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!nextAt) return;
    const id = window.setTimeout(() => {
      if (!document.hidden) void refresh();
    }, Math.max(0, nextAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [nextAt, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastStart.current >= REFRESH_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  /* ---------- derived lists */
  /* merged by id, then by normalised title: a publisher's own feed wins over the same headline on a wire */
  const all = useMemo(() => {
    const map = new Map<string, Item>();
    const keys = new Set<string>();
    const pass = (wire: boolean) => {
      for (const b of batches) {
        if (!b.data) continue;
        for (const it of b.data.items) {
          if (isWire(it.sourceId) !== wire || map.has(it.id)) continue;
          if (it.key.length > 20) {
            if (keys.has(it.key)) continue;
            keys.add(it.key);
          }
          map.set(it.id, it);
        }
      }
    };
    pass(false);
    pass(true);
    return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
  }, [batches]);

  const statusById = useMemo(() => {
    const m = new Map<string, SourceStatus>();
    for (const b of batches) if (b.data) for (const s of b.data.sources) m.set(s.id, s);
    return m;
  }, [batches]);

  const health = useMemo<Health>(() => {
    const failedList: SourceStatus[] = [];
    let ok = 0;
    for (const s of SOURCES) {
      const st = statusById.get(s.id);
      if (!st) continue;
      if (st.ok) ok++;
      else failedList.push(st);
    }
    return { ok, failed: failedList.length, pending: SOURCES.length - ok - failedList.length, failedList };
  }, [statusById]);

  const batchErrors = useMemo(() => batches.filter((b) => b.error).length, [batches]);
  const query = useMemo(() => parseSearch(search), [search]);
  const matcher = useMemo(() => buildMatcher(prefs.watchlist), [prefs.watchlist]);
  const winMs = WINDOWS.find((w) => w.id === prefs.window)?.ms ?? WINDOWS[2].ms;

  /* window + search: the base every count and list derives from */
  const base = useMemo(() => {
    const cutoff = now - winMs;
    return all.filter((it) => it.ts >= cutoff && matchesSearch(it, query));
  }, [all, now, winMs, query]);

  const hits = useMemo(() => {
    const s = new Set<string>();
    if (matcher) for (const it of base) if (matcher.re.test(it.txt)) s.add(it.id);
    return s;
  }, [base, matcher]);

  const counts = useMemo<Counts>(() => {
    const c: Counts = { lane: {}, region: {}, lang: {}, src: {} };
    for (const it of base) {
      c.lane[it.lane] = (c.lane[it.lane] ?? 0) + 1;
      c.region[it.region] = (c.region[it.region] ?? 0) + 1;
      c.lang[it.lang] = (c.lang[it.lang] ?? 0) + 1;
      c.src[it.sourceId] = (c.src[it.sourceId] ?? 0) + 1;
    }
    return c;
  }, [base]);

  const watchCounts = useMemo(
    () =>
      prefs.watchlist.map((term) => {
        const m = buildMatcher([term]);
        let n = 0;
        if (m) for (const it of base) if (m.re.test(it.txt)) n++;
        return n;
      }),
    [base, prefs.watchlist],
  );

  const shown = useMemo(() => {
    const lanes = new Set(prefs.lanes);
    const regions = new Set(prefs.regions);
    const langs = new Set(prefs.langs);
    const off = new Set(prefs.disabledSources);
    return base.filter(
      (it) =>
        lanes.has(it.lane) && regions.has(it.region) && langs.has(it.lang) && !off.has(it.sourceId) && (!prefs.watchOnly || hits.has(it.id)),
    );
  }, [base, hits, prefs.lanes, prefs.regions, prefs.langs, prefs.disabledSources, prefs.watchOnly]);

  const savedIds = useMemo(() => new Set(prefs.saved.map((s) => s.id)), [prefs.saved]);

  /* ---------- intelligence layer: entities, geo, graph and patterns over the filtered set */
  const watchFn = useCallback((text: string) => !!matcher && matcher.re.test(fold(text)), [matcher]);
  const snapshot = useMemo<IntelSnapshot | null>(
    () => (firstDone || all.length ? buildIntel(shown, { now, watch: watchFn }) : null),
    [shown, now, watchFn, firstDone, all.length],
  );

  /* entity ids of the selected country; items mentioning any of them stay visible */
  const countryEntities = useMemo(() => {
    const s = new Set<string>();
    if (country && snapshot) for (const e of Object.values(snapshot.entities)) if (e.kind === "country" && e.iso2 === country) s.add(e.id);
    return s;
  }, [country, snapshot]);

  const visible = useMemo(() => {
    if (!country || !snapshot) return shown;
    if (!countryEntities.size) return [];
    return shown.filter((it) => (snapshot.mentions[it.id] ?? []).some((eid) => countryEntities.has(eid)));
  }, [shown, country, snapshot, countryEntities]);

  /* the graph and intel views follow the country filter; the globe keeps every point so another country can be picked */
  const viewSnapshot = useMemo<IntelSnapshot | null>(
    () => (country && snapshot ? buildIntel(visible, { now, watch: watchFn }) : snapshot),
    [country, snapshot, visible, now, watchFn],
  );

  const itemMap = useMemo(() => {
    const m = new Map<string, ViewItem>();
    for (const it of shown) m.set(it.id, { id: it.id, title: it.title, source: it.publisher ?? it.source, lane: it.lane, ts: it.ts, link: it.link });
    return m;
  }, [shown]);

  const graph = useMemo(() => (viewSnapshot ? mergeBriefIntoGraph(viewSnapshot, brief) : { nodes: [] as GraphNode[], links: [] as GraphLink[] }), [viewSnapshot, brief]);

  /* ---------- handlers */
  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const toggleView = useCallback(
    () => setPrefs((p) => ({ ...p, view: VIEWS[(VIEWS.findIndex((v) => v.id === p.view) + 1) % VIEWS.length].id })),
    [],
  );
  const toggleWatchOnly = useCallback(() => setPrefs((p) => ({ ...p, watchOnly: !p.watchOnly })), []);
  const toggleTheme = useCallback(() => setPrefs((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" })), []);
  const togglePanel = useCallback((id: string) => setPrefs((p) => ({ ...p, collapsed: p.collapsed.includes(id) ? p.collapsed.filter((c) => c !== id) : [...p.collapsed, id] })), []);
  const toggleTicker = useCallback(() => togglePanel("ticker"), [togglePanel]);
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);
  const setView = useCallback((view: View) => setPrefs((p) => ({ ...p, view })), []);
  const toggleSaved = useCallback((it: Item) => {
    setPrefs((p) => {
      const has = p.saved.some((s) => s.id === it.id);
      const saved = has ? p.saved.filter((s) => s.id !== it.id) : [toNewsItem(it), ...p.saved].slice(0, SAVED_MAX);
      return { ...p, saved };
    });
  }, []);
  const unsave = useCallback((id: string) => setPrefs((p) => ({ ...p, saved: p.saved.filter((s) => s.id !== id) })), []);
  const clearSaved = useCallback(() => setPrefs((p) => ({ ...p, saved: [] })), []);
  const addWatch = useCallback((term: string) => {
    setPrefs((p) => {
      const t = term.trim();
      const f = fold(t);
      if (!f || p.watchlist.some((w) => fold(w) === f)) return p;
      return { ...p, watchlist: [...p.watchlist, t].slice(0, WATCHLIST_MAX) };
    });
  }, []);
  const removeWatch = useCallback((term: string) => setPrefs((p) => ({ ...p, watchlist: p.watchlist.filter((w) => w !== term) })), []);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const selectCountry = useCallback((iso2: string | null) => setCountry((c) => (iso2 && c === iso2 ? null : iso2)), []);
  /* the country card: the globe sheet opens it, and its News button returns to the lanes with the country filter kept */
  const openCard = useCallback((iso2: string) => {
    setCountry(iso2.toUpperCase());
    /* the card opens on its overview even when the screener or compare tab was left open last time */
    setPrefs((p) => ({ ...p, view: "countries", countryTab: "overview" }));
  }, []);
  const showCountryNews = useCallback((iso2: string) => {
    setCountry(iso2.toUpperCase());
    setPrefs((p) => ({ ...p, view: "lanes" }));
  }, []);
  const setCompare = useCallback((compare: string[]) => setPrefs((p) => ({ ...p, compare })), []);
  const setCountryTab = useCallback((countryTab: string) => setPrefs((p) => ({ ...p, countryTab })), []);

  /* ---------- AI brief: the currently visible items, newest first, capped, with the local patterns and watchlist */
  const briefAbort = useRef<AbortController | null>(null);
  /* a brief still in flight when the dashboard unmounts is dropped, not applied to a gone tree */
  useEffect(() => () => briefAbort.current?.abort(), []);
  const generateBrief = useCallback(async () => {
    if (!viewSnapshot || briefState === "loading") return;
    const list = visible.slice(0, BRIEF_ITEMS);
    if (!list.length) {
      setBriefState("error");
      setBriefError("nothing to brief: widen the window or clear filters");
      return;
    }
    const langs = { en: 0, fr: 0 };
    for (const it of list) if (it.lang === "fr") langs.fr++; else langs.en++;
    const body: BriefRequest = {
      window: prefs.window + (country ? ` ${country}` : ""),
      lang: langs.fr > langs.en ? "fr" : "en",
      items: list.map((it) => ({
        id: it.id,
        title: it.title,
        source: it.publisher ?? it.source,
        publishedAt: it.publishedAt,
        lane: it.lane,
        region: it.region,
        ...(it.summary ? { summary: it.summary.slice(0, 240) } : {}),
      })),
      patterns: viewSnapshot.patterns.slice(0, 12).map((p) => ({ title: p.title, detail: p.detail })),
      watchlist: prefs.watchlist,
      model: prefs.briefModel,
    };
    briefAbort.current?.abort();
    const ctrl = new AbortController();
    briefAbort.current = ctrl;
    const timeout = AbortSignal.timeout(BRIEF_TIMEOUT_MS);
    timeout.addEventListener("abort", () => ctrl.abort(), { once: true });
    setBriefState("loading");
    setBriefError(undefined);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Brief> & { error?: string };
      if (!res.ok || typeof data.headline !== "string") throw new Error(data.error || `HTTP ${res.status}`);
      const b = data as Brief;
      setBrief(b);
      saveBrief(b);
      setBriefState("idle");
    } catch (e) {
      if (ctrl.signal.aborted && !timeout.aborted) return;
      setBriefState("error");
      setBriefError(errMsg(e) === "timeout" || timeout.aborted ? "brief timed out after 110s" : errMsg(e));
    }
  }, [viewSnapshot, visible, briefState, prefs.window, prefs.watchlist, country]);
  const onGenerate = useCallback(() => void generateBrief(), [generateBrief]);

  /* ---------- keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = !!el && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable);
      if (e.key === "Escape") {
        if (!typing || el === searchRef.current) {
          setSearch("");
          searchRef.current?.blur();
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case "r": void refresh(); break;
        case "v": toggleView(); break;
        case "w": toggleWatchOnly(); break;
        case "t": toggleTheme(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, toggleView, toggleWatchOnly, toggleTheme]);

  /* ---------- layout: three columns from 1180px, the workspace under the board between 860 and 1179px, a single scrolling page below */
  const lOff = !narrow && collapsed.has("sidebar");
  const rOff = !narrow && collapsed.has("right");
  const sideCol = lOff ? "26px" : "232px";
  const rightCol = rOff ? "26px" : "288px";
  const bodyStyle = narrow
    ? undefined
    : wide
      ? { gridTemplateColumns: `${sideCol} minmax(0, 1fr) ${rightCol}`, gridTemplateRows: "minmax(0, 1fr)" }
      : { gridTemplateColumns: `${sideCol} minmax(0, 1fr)`, gridTemplateRows: "minmax(0, 1fr) auto" };
  const mainLabel = prefs.view === "intel" ? "Intelligence" : prefs.view === "globe" ? "Globe" : prefs.view === "graph" ? "Graph" : prefs.view === "countries" ? "Countries" : "Headlines";

  return (
    <div className="flex min-h-dvh flex-col min-[860px]:h-dvh">
      <TopBar
        updatedAt={updatedAt}
        nextAt={nextAt}
        loading={loading}
        shown={visible.length}
        total={all.length}
        ok={health.ok}
        failed={health.failed}
        batchErrors={batchErrors}
        search={search}
        searchRef={searchRef}
        view={prefs.view}
        country={country}
        watchOnly={prefs.watchOnly}
        theme={prefs.theme}
        onSearch={setSearch}
        onView={setView}
        onCountry={selectCountry}
        onWatchOnly={toggleWatchOnly}
        onTheme={toggleTheme}
        onRefresh={onRefresh}
        onFilters={openFilters}
      />
      <Ticker quotes={quotes} error={quotesError} open={!collapsed.has("ticker")} onToggle={toggleTicker} />
      {/* the composition below depends on the viewport, so it waits for the media query instead of repainting from desktop to phone */}
      <div className={narrow ? "block" : "grid min-h-0 flex-1"} style={bodyStyle}>
        {layoutKnown && (
          <>
            <Sidebar
              prefs={prefs}
              counts={counts}
              statusById={statusById}
              narrow={narrow}
              update={update}
              collapsed={collapsed}
              onToggle={togglePanel}
              sheetOpen={filtersOpen}
              onSheetOpen={setFiltersOpen}
            />
            <main
              className={narrow ? "block" : "col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden"}
              aria-label={mainLabel}
            >
              {/* the unconverted views keep their CSS Modules; the legacy scope carries the old variables and element defaults for them */}
              {prefs.view === "globe" ? (
                <div className="legacy view-fill">
                  {snapshot ? (
                    <GlobeView points={snapshot.points} flows={snapshot.flows} items={itemMap} theme={prefs.theme} onSelectCountry={selectCountry} onOpenCard={openCard} selected={country} />
                  ) : (
                    <Loading what="globe" />
                  )}
                </div>
              ) : prefs.view === "graph" ? (
                <div className="legacy view-fill">
                  {viewSnapshot ? (
                    <GraphView nodes={graph.nodes} links={graph.links} items={itemMap} theme={prefs.theme} focus={graphFocus} onFocus={setGraphFocus} />
                  ) : (
                    <Loading what="graph" />
                  )}
                </div>
              ) : prefs.view === "countries" ? (
                <div className="legacy contents">
                  <CountryView
                    snapshot={snapshot}
                    items={itemMap}
                    selected={country}
                    onSelect={setCountry}
                    compare={prefs.compare}
                    onCompare={setCompare}
                    theme={prefs.theme}
                    window={prefs.window}
                    onSearch={setSearch}
                    onShowNews={showCountryNews}
                    tab={prefs.countryTab}
                    onTab={setCountryTab}
                  />
                </div>
              ) : prefs.view === "intel" ? (
                <div className="legacy contents">
                  <IntelPanel
                    snapshot={viewSnapshot}
                    brief={brief}
                    briefState={briefState}
                    briefError={briefError}
                    onGenerate={onGenerate}
                    model={prefs.briefModel}
                    onModel={(m) => setPrefs((p) => ({ ...p, briefModel: m }))}
                    onSearch={setSearch}
                    items={itemMap}
                    watchlist={prefs.watchlist}
                    onAddWatch={addWatch}
                    window={prefs.window}
                    now={now}
                  />
                </div>
              ) : (
                <LaneBoard
                  items={visible}
                  view={prefs.view}
                  lanes={prefs.lanes}
                  narrow={narrow}
                  loading={(loading || !firstDone) && all.length === 0}
                  failed={firstDone && !loading && all.length === 0 && batchErrors > 0}
                  matcher={matcher}
                  hits={hits}
                  savedIds={savedIds}
                  newIds={newIds}
                  now={now}
                  onStar={toggleSaved}
                />
              )}
            </main>
            <div className={cn(narrow ? "block" : "flex min-h-0 flex-col", !narrow && (wide ? "col-start-3 row-start-1" : "col-start-2 row-start-2 max-h-[38dvh]"), !narrow && !wide && rOff && "max-h-none")}>
              <RightPanel
                watchlist={prefs.watchlist}
                watchCounts={watchCounts}
                saved={prefs.saved}
                health={health}
                now={now}
                narrow={narrow}
                wide={wide}
                collapsed={collapsed}
                onToggle={togglePanel}
                onAddWatch={addWatch}
                onRemoveWatch={removeWatch}
                onSearchTerm={setSearch}
                onUnsave={unsave}
                onClearSaved={clearSaved}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
