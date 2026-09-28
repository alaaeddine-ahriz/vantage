/**
 * Offline tests for the intelligence engine: gazetteer sanity, entity
 * extraction and buildIntel on the mock feed. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { extractEntities } from "../src/lib/entities";
import { GAZETTEER } from "../src/lib/gazetteer";
import { buildIntel, clusterScoreOf, coMovementScoreOf, emergingScoreOf, rankPatterns, resetIntelCache, spikeScoreOf } from "../src/lib/intel";
import type { IntelItem, Pattern } from "../src/lib/intel-types";
import { mockFeeds } from "../src/lib/mock";
import { fold } from "../src/lib/text";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}`);
    const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.log(text.replace(/^/gm, "    "));
  }
}

function mockItems(): IntelItem[] {
  const items: IntelItem[] = [];
  for (let b = 0; b < 4; b++) {
    for (const it of mockFeeds(b, 4).items) items.push({ ...it, ts: Date.parse(it.publishedAt) });
  }
  return items;
}

test("gazetteer: unique ids, coords on countries, folded aliases, unique aliases", () => {
  const ids = new Set<string>();
  const aliasOwner = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const e of GAZETTEER) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    if (e.kind === "country") {
      assert.ok(typeof e.lat === "number" && typeof e.lng === "number", `${e.id} has coords`);
      assert.equal(e.iso2, e.id.toUpperCase());
    }
    assert.ok(e.aliases.length > 0, `${e.id} has aliases`);
    for (const a of e.aliases) {
      assert.equal(a, fold(a), `${e.id}: alias "${a}" is folded`);
      assert.equal(a, a.trim(), `${e.id}: alias "${a}" is trimmed`);
      const owner = aliasOwner.get(a);
      assert.ok(!owner, `alias "${a}" belongs to both ${owner} and ${e.id}`);
      aliasOwner.set(a, e.id);
    }
  }
  assert.ok(counts.country >= 190, `countries: ${counts.country}`);
  assert.ok(counts.company >= 120, `companies: ${counts.company}`);
  assert.ok(counts.commodity >= 15, `commodities: ${counts.commodity}`);
  assert.ok(counts.topic >= 20, `topics: ${counts.topic}`);
  // sorted by kind
  const order = ["country", "company", "commodity", "org", "topic"];
  let last = -1;
  for (const e of GAZETTEER) {
    const k = order.indexOf(e.kind);
    assert.ok(k >= last, "sorted by kind");
    last = k;
  }
  console.log(`    ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
});

test("extractEntities: OPEC and Aramco, no pronoun countries", () => {
  const ids = extractEntities("Aramco cuts October OSPs for Asian buyers as OPEC+ extends cuts");
  assert.deepEqual(ids, ["aramco", "opec"]);
});

test("extractEntities: French headline", () => {
  const ids = extractEntities("Le Qatar signe un contrat GNL de 15 ans avec la Chine");
  assert.deepEqual(ids, ["qa", "natgas", "cn"]);
});

test("extractEntities: upper-case US, nested steel, tariffs", () => {
  const ids = extractEntities("US Steel says tariffs help");
  assert.ok(ids.includes("us"), `has us: ${ids}`);
  assert.ok(ids.includes("steel"), `has steel: ${ids}`);
  assert.ok(ids.includes("tariffs"), `has tariffs: ${ids}`);
  assert.ok(ids.includes("ussteel"), `has ussteel: ${ids}`);
});

test("extractEntities: lowercase us and French eu are not countries", () => {
  assert.deepEqual(extractEntities("tell us about it"), []);
  assert.deepEqual(extractEntities("Le gouvernement a eu raison"), []);
  assert.deepEqual(extractEntities("EU approves sanctions on Russian LNG"), ["eu", "sanctions", "ru", "natgas"]);
});

test("extractEntities: diacritics, blocked phrases and order", () => {
  assert.deepEqual(extractEntities("L'Algérie augmente ses exportations de gaz vers l'Italie"), ["dz", "natgas", "it"]);
  assert.deepEqual(extractEntities("Dow Jones slips as Dow Inc cuts guidance"), ["dow"]);
  assert.deepEqual(extractEntities("Saudi Aramco and Sinopec sign a refinery deal in China"), ["aramco", "sinopec", "refinery", "cn"]);
});

test("buildIntel: mock feed yields points, flows, graph and patterns", () => {
  resetIntelCache();
  const items = mockItems();
  assert.ok(items.length > 50, `mock items: ${items.length}`);
  const snap = buildIntel(items, { now: Date.now(), watch: (t) => /opec|lng/i.test(t) });
  assert.ok(snap.points.length > 5, `points: ${snap.points.length}`);
  assert.ok(snap.flows.length >= 1, `flows: ${snap.flows.length}`);
  assert.ok(snap.graph.nodes.length > 10, `nodes: ${snap.graph.nodes.length}`);
  assert.ok(snap.graph.links.length > 0, "links");
  assert.ok(snap.patterns.length >= 1, `patterns: ${snap.patterns.length}`);
  assert.ok(Object.keys(snap.mentions).length === items.length, "mentions for every item");
  for (const f of snap.flows) assert.notEqual(f.from, f.to);
  for (const l of snap.graph.links) {
    assert.ok(snap.graph.nodes.some((n) => n.id === l.source) && snap.graph.nodes.some((n) => n.id === l.target), "links reference nodes");
  }
  const ids = new Set(snap.graph.nodes.map((n) => n.id));
  assert.equal(ids.size, snap.graph.nodes.length, "unique node ids");
  const pids = new Set(snap.patterns.map((p) => p.id));
  assert.equal(pids.size, snap.patterns.length, "unique pattern ids");
  console.log(
    `    points=${snap.points.length} flows=${snap.flows.length} nodes=${snap.graph.nodes.length} links=${snap.graph.links.length} patterns=${snap.patterns.length} (${snap.patterns
      .slice(0, 4)
      .map((p) => p.title)
      .join(" | ")})`,
  );
});

test("pattern scores: bounded in [0, 1] and not saturated by tiny counts", () => {
  const within = (v: number) => v >= 0 && v <= 1;
  for (let recent = 0; recent <= 40; recent++) {
    for (const baseline of [0, 0.5, 1, 3, 10]) assert.ok(within(spikeScoreOf(recent, baseline)), `spike(${recent}, ${baseline})`);
    assert.ok(within(emergingScoreOf(recent)), `emerging(${recent})`);
    assert.ok(within(clusterScoreOf(recent)), `cluster(${recent})`);
    for (const other of [0, 3, 6, 20]) assert.ok(within(coMovementScoreOf(recent, other, 6)), `co-movement(${recent}, ${other})`);
  }
  /* three mentions against a quiet week is a weak spike, not a 100 */
  assert.ok(spikeScoreOf(3, 0) < 0.5, `spike(3, 0) = ${spikeScoreOf(3, 0)}`);
  assert.ok(spikeScoreOf(8, 0) > spikeScoreOf(3, 0), "more mentions, higher spike");
  assert.equal(spikeScoreOf(12, 0), 1);
  assert.ok(spikeScoreOf(6, 3) < spikeScoreOf(6, 0), "a higher baseline lowers the spike");
  assert.equal(spikeScoreOf(2, 4), 0, "below baseline is zero");
  /* one shared headline between two thinly mentioned entities is far from 100 */
  assert.ok(coMovementScoreOf(1, 3, 3) <= 0.1, `co-movement(1, 3, 3) = ${coMovementScoreOf(1, 3, 3)}`);
  assert.ok(coMovementScoreOf(2, 3, 3) < 0.25, `co-movement(2, 3, 3) = ${coMovementScoreOf(2, 3, 3)}`);
  assert.equal(coMovementScoreOf(5, 6, 9), 1);
  assert.equal(emergingScoreOf(3), 0.5);
  assert.equal(clusterScoreOf(4), 0.5);
});

test("rankPatterns: score order with no kind above 40% of the first 10", () => {
  const mk = (kind: Pattern["kind"], i: number, score: number): Pattern => ({
    id: `${kind}:${i}`, kind, title: kind, detail: "", score, entityIds: [], itemIds: [],
  });
  const list: Pattern[] = [];
  for (let i = 0; i < 25; i++) list.push(mk("co-movement", i, 1));
  for (let i = 0; i < 6; i++) list.push(mk("spike", i, 0.9 - i * 0.05));
  for (let i = 0; i < 3; i++) list.push(mk("emerging", i, 0.5));
  for (let i = 0; i < 3; i++) list.push(mk("cluster", i, 0.4));
  const ranked = rankPatterns(list);
  assert.equal(ranked.length, list.length, "nothing dropped");
  assert.equal(new Set(ranked.map((p) => p.id)).size, list.length, "nothing duplicated");
  const head = ranked.slice(0, 10);
  const perKind = new Map<string, number>();
  for (const p of head) perKind.set(p.kind, (perKind.get(p.kind) ?? 0) + 1);
  for (const [kind, n] of perKind) assert.ok(n <= 4, `${kind} takes ${n} of the first 10`);
  assert.deepEqual([...perKind.entries()], [["co-movement", 4], ["spike", 4], ["emerging", 2]], "head fills by score under the cap");
  assert.equal(ranked[0].kind, "co-movement", "the top score still leads");
  /* inside one kind the score order is kept */
  const spikes = ranked.filter((p) => p.kind === "spike").map((p) => p.score);
  assert.deepEqual(spikes, [...spikes].sort((a, b) => b - a));
  /* after the head the deferred entries follow in score order */
  const tail = ranked.slice(10).map((p) => p.score);
  assert.deepEqual(tail, [...tail].sort((a, b) => b - a));
  /* a single kind is passed through untouched */
  const only = rankPatterns(list.filter((p) => p.kind === "co-movement"));
  assert.equal(only.length, 25);
});

test("buildIntel: co-movement needs 3 mentions each and 2 shared headlines", () => {
  resetIntelCache();
  const now = Date.now();
  const mk = (id: string, title: string, hoursAgo: number): IntelItem => ({
    id, title, link: "", summary: "", publishedAt: new Date(now - hoursAgo * 3_600_000).toISOString(), sourceId: "t", source: "t",
    region: "global", lang: "en", lanes: ["oilgas"], lane: "oilgas", ts: now - hoursAgo * 3_600_000,
  });
  /* one shared headline, three mentions each: no co-movement */
  const thin = [
    mk("a1", "Qatar and LNG exports climb", 1),
    mk("a2", "Qatar budget update", 2), mk("a3", "Qatar election", 3),
    mk("a4", "LNG prices in Asia", 4), mk("a5", "LNG tanker rates", 5),
  ];
  const s1 = buildIntel(thin, { now });
  assert.ok(!s1.patterns.some((p) => p.kind === "co-movement"), "single shared headline is not co-movement");
  /* two shared headlines: co-movement, with a modest score */
  const s2 = buildIntel([...thin, mk("a6", "Qatar signs new LNG deal", 6)], { now });
  const co = s2.patterns.find((p) => p.kind === "co-movement");
  assert.ok(co, "co-movement found");
  assert.ok(co!.score > 0 && co!.score < 0.5, `modest score: ${co!.score}`);
  for (const p of s2.patterns) assert.ok(p.score >= 0 && p.score <= 1, `${p.id} score in range`);
});

test("buildIntel: 1150 items under 300 ms, cached rerun faster", () => {
  resetIntelCache();
  const base = mockItems();
  const items: IntelItem[] = [];
  for (let k = 0; k < 10; k++) {
    for (const it of base) items.push({ ...it, id: `${it.id}-${k}`, ts: it.ts - k * 3_600_000 });
  }
  extractEntities("warm up the regex");
  const t0 = performance.now();
  const snap = buildIntel(items, { now: Date.now() });
  const cold = performance.now() - t0;
  const t1 = performance.now();
  buildIntel(items, { now: Date.now() });
  const warm = performance.now() - t1;
  console.log(`    ${items.length} items: cold ${cold.toFixed(1)} ms, cached ${warm.toFixed(1)} ms, nodes=${snap.graph.nodes.length}`);
  assert.ok(cold < 300, `cold build under 300 ms (${cold.toFixed(1)} ms)`);
  assert.ok(snap.graph.nodes.length <= 250, "maxNodes default respected");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
