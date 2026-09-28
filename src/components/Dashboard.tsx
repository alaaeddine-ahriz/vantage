"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedsResponse, MarketsResponse, Quote, SourceStatus } from "@/lib/types";
import { FEED_BATCHES, SOURCES } from "@/lib/sources";
import TopBar from "./TopBar";
import Ticker from "./Ticker";
import Sidebar from "./Sidebar";
import LaneBoard from "./LaneBoard";
import RightPanel from "./RightPanel";
import {
  buildMatcher, fold, loadPrefs, matchesSearch, parseSearch, savePrefs, toItem, toNewsItem, useMediaQuery, useNow,
  DEFAULT_PREFS, REFRESH_MS, SAVED_MAX, WINDOWS,
  type Counts, type Health, type Item, type Prefs, type View,
} from "./util";

interface Batch {
  data: { items: Item[]; sources: SourceStatus[] } | null;
  error: string | null;
}

const emptyBatches = (): Batch[] => Array.from({ length: FEED_BATCHES }, () => ({ data: null, error: null }));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "request failed");

export default function Dashboard() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [batches, setBatches] = useState<Batch[]>(emptyBatches);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [nextAt, setNextAt] = useState(0);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const fresh = useRef<Set<string>>(new Set());
  const inflight = useRef(false);
  const lastStart = useRef(0);
  const narrow = useMediaQuery("(max-width: 859px)");
  const tick = useNow(30_000);
  const now = tick || Date.now();

  /* ---------- preferences: read after mount, write on change, apply theme */
  useEffect(() => {
    const p = loadPrefs();
    if (p) setPrefs(p);
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) savePrefs(prefs);
  }, [prefs, ready]);
  useEffect(() => {
    if (ready) document.documentElement.setAttribute("data-theme", prefs.theme);
  }, [prefs.theme, ready]);

  /* ---------- data */
  const fetchBatch = useCallback(async (i: number, markNew: boolean) => {
    try {
      const res = await fetch(`/api/feeds?batch=${i}&of=${FEED_BATCHES}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FeedsResponse;
      const items = (data.items ?? []).map(toItem);
      for (const it of items) {
        if (seen.current.has(it.id)) continue;
        seen.current.add(it.id);
        if (markNew) fresh.current.add(it.id);
      }
      if (markNew) setNewIds(new Set(fresh.current));
      setBatches((prev) => prev.map((b, k) => (k === i ? { data: { items, sources: data.sources ?? [] }, error: null } : b)));
    } catch (e) {
      const error = errMsg(e);
      setBatches((prev) => prev.map((b, k) => (k === i ? { ...b, error } : b)));
    }
  }, []);

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
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
    await Promise.allSettled([...jobs, fetchMarkets()]);
    inflight.current = false;
    setLoading(false);
    setUpdatedAt(Date.now());
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
  const all = useMemo(() => {
    const map = new Map<string, Item>();
    for (const b of batches) if (b.data) for (const it of b.data.items) if (!map.has(it.id)) map.set(it.id, it);
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

  /* ---------- handlers */
  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const toggleView = useCallback(() => setPrefs((p) => ({ ...p, view: p.view === "lanes" ? "stream" : "lanes" })), []);
  const toggleWatchOnly = useCallback(() => setPrefs((p) => ({ ...p, watchOnly: !p.watchOnly })), []);
  const toggleTheme = useCallback(() => setPrefs((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" })), []);
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
      const f = fold(term.trim());
      if (!f || p.watchlist.some((w) => fold(w) === f)) return p;
      return { ...p, watchlist: [...p.watchlist, term.trim()].slice(0, 200) };
    });
  }, []);
  const removeWatch = useCallback((term: string) => setPrefs((p) => ({ ...p, watchlist: p.watchlist.filter((w) => w !== term) })), []);
  const onRefresh = useCallback(() => void refresh(), [refresh]);

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

  return (
    <div className="app">
      <TopBar
        updatedAt={updatedAt}
        nextAt={nextAt}
        loading={loading}
        shown={shown.length}
        total={all.length}
        ok={health.ok}
        failed={health.failed}
        batchErrors={batchErrors}
        search={search}
        searchRef={searchRef}
        view={prefs.view}
        watchOnly={prefs.watchOnly}
        theme={prefs.theme}
        onSearch={setSearch}
        onView={setView}
        onWatchOnly={toggleWatchOnly}
        onTheme={toggleTheme}
        onRefresh={onRefresh}
      />
      <Ticker quotes={quotes} error={quotesError} />
      <div className="body">
        <Sidebar prefs={prefs} counts={counts} statusById={statusById} narrow={narrow} update={update} />
        <main className="main" aria-label="Headlines">
          <LaneBoard
            items={shown}
            view={prefs.view}
            lanes={prefs.lanes}
            narrow={narrow}
            loading={loading && all.length === 0}
            matcher={matcher}
            hits={hits}
            savedIds={savedIds}
            newIds={newIds}
            now={now}
            onStar={toggleSaved}
          />
        </main>
        <RightPanel
          watchlist={prefs.watchlist}
          watchCounts={watchCounts}
          saved={prefs.saved}
          health={health}
          now={now}
          onAddWatch={addWatch}
          onRemoveWatch={removeWatch}
          onSearchTerm={setSearch}
          onUnsave={unsave}
          onClearSaved={clearSaved}
        />
      </div>
    </div>
  );
}
