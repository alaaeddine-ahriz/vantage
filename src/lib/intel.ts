import { ENTITY_BY_ID, extractEntities } from "./entities";
import type {
  Entity,
  Flow,
  GeoPoint,
  GraphLink,
  GraphNode,
  IntelItem,
  IntelSnapshot,
  Pattern,
} from "./intel-types";
import type { LaneId } from "./types";

/**
 * Deterministic intelligence engine: entity mentions, map points and flows,
 * the co-occurrence graph and explainable patterns. Pure TypeScript, safe in
 * the browser. Mentions are cached per item id, so a refresh that brings the
 * same items back costs one Map lookup each.
 */

export interface BuildIntelOptions {
  now: number;
  /** Watchlist test on a headline; hits weigh points and event nodes. */
  watch?: (text: string) => boolean;
  /** Graph size cap, highest weight kept. Default 250. */
  maxNodes?: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MENTION_CACHE_MAX = 20_000;
const MAX_ENTITIES_PER_ITEM = 14;

const mentionCache = new Map<string, string[]>();

function mentionsFor(item: IntelItem): string[] {
  const hit = mentionCache.get(item.id);
  if (hit) return hit;
  if (mentionCache.size >= MENTION_CACHE_MAX) mentionCache.clear();
  const ids = extractEntities(item.title + " " + (item.summary ?? "")).slice(0, MAX_ENTITIES_PER_ITEM);
  mentionCache.set(item.id, ids);
  return ids;
}

/** Country-like entities: countries, plus orgs that carry coordinates (the EU). */
function geoOf(e: Entity | undefined): Entity | undefined {
  if (!e) return undefined;
  if (e.kind === "country" || (e.kind === "org" && e.lat !== undefined && e.lng !== undefined)) return e;
  return undefined;
}

/** Map iso2 to the entity that places it (country entry or EU). */
const GEO_BY_ISO2: Record<string, Entity> = {};
for (const e of Object.values(ENTITY_BY_ID)) {
  const g = geoOf(e);
  if (g && g.iso2) GEO_BY_ISO2[g.iso2] = g;
}

function push(list: string[], id: string, cap: number): void {
  if (list.length < cap) list.push(id);
}

function bump<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function topLane(counts: Map<LaneId, number>, fallback: LaneId): LaneId {
  let best = fallback;
  let n = -1;
  for (const [lane, c] of counts) {
    if (c > n) {
      n = c;
      best = lane;
    }
  }
  return best;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "...";
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---------------------------------------------------------------- pattern scoring

const MAX_PATTERNS = 25;
/** In the first DIVERSITY_HEAD emitted patterns no kind may take more than DIVERSITY_SHARE of the slots. */
const DIVERSITY_HEAD = 10;
const DIVERSITY_SHARE = 0.4;
const CO_MIN_RECENT = 3;
const CO_MIN_SHARED = 2;

/** Lift over baseline, damped so three mentions against a quiet week do not read as a full-score spike. */
export function spikeScoreOf(recent: number, baseline: number): number {
  const lift = Math.min(1, (recent - baseline) / Math.max(4, 2 * baseline));
  return Math.max(0, lift) * Math.min(1, recent / 8);
}

export function emergingScoreOf(recent48: number): number {
  return Math.min(1, recent48 / 6);
}

export function clusterScoreOf(shared: number): number {
  return Math.min(1, shared / 8);
}

export function coMovementScoreOf(shared: number, recentA: number, recentB: number): number {
  return Math.min(1, shared / 5) * Math.min(1, Math.min(recentA, recentB) / 6);
}

/**
 * Score order with kind diversity: the list is sorted by score, then emitted so
 * that within the first DIVERSITY_HEAD entries no kind holds more than
 * DIVERSITY_SHARE of the slots. A kind that hits its cap is deferred and its
 * remaining entries follow, still in score order, once the head is filled.
 * When only capped kinds remain the cap is lifted rather than leaving a gap.
 */
export function rankPatterns(list: Pattern[]): Pattern[] {
  const sorted = [...list].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const cap = Math.floor(DIVERSITY_HEAD * DIVERSITY_SHARE);
  const out: Pattern[] = [];
  const used = new Map<string, number>();
  const deferred: Pattern[] = [];
  for (const p of sorted) {
    if (out.length >= DIVERSITY_HEAD) {
      deferred.push(p);
      continue;
    }
    const n = used.get(p.kind) ?? 0;
    if (n >= cap) {
      deferred.push(p);
      continue;
    }
    used.set(p.kind, n + 1);
    out.push(p);
  }
  /* deferred entries are already in score order relative to each other */
  return out.concat(deferred);
}

export function buildIntel(items: IntelItem[], opts: BuildIntelOptions): IntelSnapshot {
  const now = opts.now;
  const maxNodes = opts.maxNodes ?? 250;
  const watch = opts.watch;
  const total = items.length;

  // ---------------------------------------------------------------- mentions
  const mentions: Record<string, string[]> = {};
  const byItem = new Map<string, string[]>();
  const count = new Map<string, number>();
  const itemsOf = new Map<string, IntelItem[]>();
  const watchHit = new Map<string, boolean>();
  for (const it of items) {
    const ids = mentionsFor(it);
    mentions[it.id] = ids;
    byItem.set(it.id, ids);
    if (watch) watchHit.set(it.id, watch(it.title));
    for (const id of ids) {
      bump(count, id);
      const list = itemsOf.get(id);
      if (list) list.push(it);
      else itemsOf.set(id, [it]);
    }
  }

  const entities: Record<string, Entity> = {};
  for (const id of count.keys()) {
    const e = ENTITY_BY_ID[id];
    if (e) entities[id] = e;
  }

  // ---------------------------------------------------------------- points
  const points = new Map<string, GeoPoint>();
  for (const it of items) {
    const ids = byItem.get(it.id) ?? [];
    const seen = new Set<string>();
    for (const id of ids) {
      const g = geoOf(ENTITY_BY_ID[id]);
      if (!g || !g.iso2 || seen.has(g.iso2)) continue;
      seen.add(g.iso2);
      let p = points.get(g.iso2);
      if (!p) {
        p = { iso2: g.iso2, label: g.label, lat: g.lat ?? 0, lng: g.lng ?? 0, count: 0, lanes: {}, itemIds: [], watchHits: 0 };
        points.set(g.iso2, p);
      }
      p.count++;
      p.lanes[it.lane] = (p.lanes[it.lane] ?? 0) + 1;
      push(p.itemIds, it.id, 50);
      if (watchHit.get(it.id)) p.watchHits++;
    }
  }

  // ---------------------------------------------------------------- flows
  interface FlowAcc {
    from: string;
    to: string;
    count: number;
    lanes: Map<LaneId, number>;
    itemIds: string[];
  }
  const flows = new Map<string, FlowAcc>();
  for (const it of items) {
    const ids = byItem.get(it.id) ?? [];
    const geo: string[] = [];
    for (const id of ids) {
      const e = ENTITY_BY_ID[id];
      if (!e) continue;
      const iso = geoOf(e)?.iso2 ?? (e.kind === "company" ? e.iso2 : undefined);
      if (iso && !geo.includes(iso)) geo.push(iso);
    }
    if (geo.length < 2) continue;
    const from = geo[0];
    for (let i = 1; i < geo.length; i++) {
      const to = geo[i];
      const key = `${from}>${to}`;
      let f = flows.get(key);
      if (!f) {
        f = { from, to, count: 0, lanes: new Map(), itemIds: [] };
        flows.set(key, f);
      }
      f.count++;
      bump(f.lanes, it.lane);
      push(f.itemIds, it.id, 30);
    }
  }
  const flowList: Flow[] = [...flows.values()]
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .slice(0, 200)
    .map((f) => {
      const a = GEO_BY_ISO2[f.from];
      const b = GEO_BY_ISO2[f.to];
      return {
        from: f.from,
        to: f.to,
        fromLat: a?.lat ?? 0,
        fromLng: a?.lng ?? 0,
        toLat: b?.lat ?? 0,
        toLng: b?.lng ?? 0,
        count: f.count,
        lane: topLane(f.lanes, "markets"),
        itemIds: f.itemIds,
      };
    })
    .filter((f) => GEO_BY_ISO2[f.from] && GEO_BY_ISO2[f.to]);

  // ---------------------------------------------------------------- graph
  const minMentions = total < 40 ? 1 : 2;
  const minShared = total < 40 ? 1 : 2;
  const nodeById = new Map<string, GraphNode>();
  for (const [id, n] of count) {
    if (n < minMentions) continue;
    const e = ENTITY_BY_ID[id];
    if (!e) continue;
    const list = itemsOf.get(id) ?? [];
    nodeById.set(id, {
      id,
      kind: e.kind,
      label: e.label,
      weight: n,
      lane: e.sector,
      itemIds: list.slice(0, 30).map((it) => it.id),
    });
  }

  // Co-occurrence pairs between entity nodes.
  interface PairAcc {
    a: string;
    b: string;
    count: number;
    itemIds: string[];
  }
  const pairs = new Map<string, PairAcc>();
  for (const it of items) {
    const ids = (byItem.get(it.id) ?? []).filter((id) => nodeById.has(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i], ids[j]);
        let p = pairs.get(key);
        if (!p) {
          p = { a: ids[i] < ids[j] ? ids[i] : ids[j], b: ids[i] < ids[j] ? ids[j] : ids[i], count: 0, itemIds: [] };
          pairs.set(key, p);
        }
        p.count++;
        push(p.itemIds, it.id, 20);
      }
    }
  }

  // Event nodes: the most relevant multi-entity items.
  const eventCandidates = items
    .filter((it) => (byItem.get(it.id)?.length ?? 0) >= 2)
    .sort((a, b) => Number(watchHit.get(b.id) ?? false) - Number(watchHit.get(a.id) ?? false) || b.ts - a.ts)
    .slice(0, 60);
  const eventLinks: GraphLink[] = [];
  const eventNodes: GraphNode[] = [];
  for (const it of eventCandidates) {
    const ids = (byItem.get(it.id) ?? []).filter((id) => nodeById.has(id));
    if (ids.length < 2) continue;
    const eid = `event:${it.id}`;
    eventNodes.push({ id: eid, kind: "event", label: truncate(it.title, 80), weight: ids.length, lane: it.lane, itemIds: [it.id] });
    for (const id of ids) eventLinks.push({ source: eid, target: id, kind: "cooccur", weight: 1, itemIds: [it.id] });
  }

  // Size cap: highest weight first, ties by id for stability.
  const entityNodes = [...nodeById.values()].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const allNodes = [...entityNodes, ...eventNodes]
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, maxNodes);
  const kept = new Set(allNodes.map((n) => n.id));
  const links: GraphLink[] = [];
  for (const p of pairs.values()) {
    if (p.count >= minShared && kept.has(p.a) && kept.has(p.b)) {
      links.push({ source: p.a, target: p.b, kind: "cooccur", weight: p.count, itemIds: p.itemIds });
    }
  }
  for (const l of eventLinks) if (kept.has(l.source) && kept.has(l.target)) links.push(l);
  const linked = new Set<string>();
  for (const l of links) {
    linked.add(l.source);
    linked.add(l.target);
  }
  const nodes = allNodes.filter((n) => n.kind !== "event" || linked.has(n.id));

  // ---------------------------------------------------------------- patterns
  const patterns: Pattern[] = [];
  const spikeScore = new Map<string, number>();
  const recentCount = new Map<string, number>();
  const recentItemsOf = new Map<string, IntelItem[]>();
  const labelOf = (id: string) => ENTITY_BY_ID[id]?.label ?? id;

  for (const [id, list] of itemsOf) {
    let recent = 0;
    let prior = 0;
    let recent48 = 0;
    let before48 = 0;
    const recentItems: IntelItem[] = [];
    for (const it of list) {
      const age = now - it.ts;
      if (age < 0 || age > 7 * DAY) continue;
      if (age <= DAY) {
        recent++;
        recentItems.push(it);
      } else {
        prior++;
      }
      if (age <= 2 * DAY) recent48++;
      else before48++;
    }
    recentItemsOf.set(id, recentItems);
    recentCount.set(id, recent);
    const baseline = prior / 6;
    if (recent >= 3 && recent >= 2 * baseline) {
      const score = spikeScoreOf(recent, baseline);
      spikeScore.set(id, score);
      const co = new Map<string, number>();
      for (const it of recentItems) for (const other of byItem.get(it.id) ?? []) if (other !== id) bump(co, other);
      const top = [...co.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([o]) => labelOf(o));
      const base = baseline === 0 ? "none" : baseline.toFixed(1) + " per day";
      patterns.push({
        id: `spike:${id}`,
        kind: "spike",
        title: `Spike: ${labelOf(id)}`,
        detail: `${recent} mentions in 24h vs ${base} before` + (top.length ? `. With ${top.join(", ")}` : ""),
        score,
        entityIds: [id],
        itemIds: recentItems.slice(0, 20).map((it) => it.id),
      });
    }
    if (recent48 >= 3 && before48 === 0) {
      const its = list.filter((it) => now - it.ts <= 2 * DAY && now - it.ts >= 0);
      patterns.push({
        id: `emerging:${id}`,
        kind: "emerging",
        title: `Emerging: ${labelOf(id)}`,
        detail: `${recent48} mentions in 48h, none in the five days before. ${truncate(its[0]?.title ?? "", 90)}`,
        score: emergingScoreOf(recent48),
        entityIds: [id],
        itemIds: its.slice(0, 20).map((it) => it.id),
      });
    }
  }

  // Clusters: strongest co-occurrence pairs.
  const clusterPairs = [...pairs.values()]
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.count - a.count || a.a.localeCompare(b.a) || a.b.localeCompare(b.b))
    .slice(0, 12);
  const titleOf = new Map(items.map((it) => [it.id, it.title]));
  for (const p of clusterPairs) {
    const heads = p.itemIds.slice(0, 2).map((id) => truncate(titleOf.get(id) ?? id, 70));
    patterns.push({
      id: `cluster:${p.a}:${p.b}`,
      kind: "cluster",
      title: `${labelOf(p.a)} x ${labelOf(p.b)}`,
      detail: `${p.count} shared headlines: ${heads.join(" / ")}`,
      score: clusterScoreOf(p.count),
      entityIds: [p.a, p.b],
      itemIds: p.itemIds,
    });
  }

  // Co-movement: a country and a commodity spiking together in the same headlines.
  // Both need at least CO_MIN_RECENT mentions in 24h and CO_MIN_SHARED shared headlines,
  // so a single headline naming a country and a commodity is not a pattern.
  for (const a of spikeScore.keys()) {
    const ea = ENTITY_BY_ID[a];
    if (!ea || (ea.kind !== "country" && ea.kind !== "org")) continue;
    const recentA = recentCount.get(a) ?? 0;
    if (recentA < CO_MIN_RECENT) continue;
    for (const b of spikeScore.keys()) {
      const eb = ENTITY_BY_ID[b];
      if (!eb || eb.kind !== "commodity") continue;
      const recentB = recentCount.get(b) ?? 0;
      if (recentB < CO_MIN_RECENT) continue;
      const shared = (recentItemsOf.get(a) ?? []).filter((it) => byItem.get(it.id)?.includes(b));
      if (shared.length < CO_MIN_SHARED) continue;
      patterns.push({
        id: `co-movement:${a}:${b}`,
        kind: "co-movement",
        title: `${labelOf(a)} and ${labelOf(b)} rising together`,
        detail: `Both spiked in the last 24h, ${shared.length} shared headlines: ${truncate(shared[0].title, 70)}`,
        score: coMovementScoreOf(shared.length, recentA, recentB),
        entityIds: [a, b],
        itemIds: shared.slice(0, 20).map((it) => it.id),
      });
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    entities,
    mentions,
    points: [...points.values()].sort((a, b) => b.count - a.count || a.iso2.localeCompare(b.iso2)),
    flows: flowList,
    graph: { nodes, links },
    patterns: rankPatterns(patterns).slice(0, MAX_PATTERNS),
  };
}

/** Clears the per-item mention cache (tests). */
export function resetIntelCache(): void {
  mentionCache.clear();
}
