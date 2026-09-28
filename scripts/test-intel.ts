/**
 * Offline tests for the intelligence engine: gazetteer sanity, entity
 * extraction and buildIntel on the mock feed. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { extractEntities } from "../src/lib/entities";
import { GAZETTEER } from "../src/lib/gazetteer";
import { buildIntel, resetIntelCache } from "../src/lib/intel";
import type { IntelItem } from "../src/lib/intel-types";
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
