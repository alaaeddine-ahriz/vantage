/**
 * Offline tests for the AI brief layer: request validation, the deterministic
 * mock brief and response normalisation. Run with `npm test` (tsx, no network).
 */
import assert from "node:assert/strict";
import { BRIEF_SCHEMA, buildMockBrief, entityWords, normalizeBrief, validateBriefRequest } from "../src/lib/brief";
import type { BriefRequest, LinkKind } from "../src/lib/intel-types";
import { mockFeeds } from "../src/lib/mock";
import { LANES } from "../src/lib/types";

const KINDS: LinkKind[] = ["causes", "impacts", "triggers", "responds", "supplies"];
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

function sampleRequest(n = 30): BriefRequest {
  const items = mockFeeds(0, 1).items.slice(0, n);
  assert.equal(items.length, n, "mock feed yields enough items");
  return {
    window: "24h",
    lang: "en",
    items: items.map((it) => ({ id: it.id, title: it.title, source: it.source, publishedAt: it.publishedAt, lane: it.lane, region: it.region, summary: it.summary })),
    patterns: [{ title: "Spike: LNG", detail: "LNG mentions doubled" }],
    watchlist: ["OPEC", "LNG"],
  };
}

/* Every object in the schema must forbid unknown keys so the model cannot smuggle extra fields. */
function everyObjectIsClosed(node: unknown, path = "root"): void {
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o.type === "object") {
    assert.equal(o.additionalProperties, false, `${path} sets additionalProperties: false`);
    assert.ok(Array.isArray(o.required), `${path} lists required keys`);
    for (const [k, v] of Object.entries(o.properties as Record<string, unknown>)) everyObjectIsClosed(v, `${path}.${k}`);
  }
  if (o.type === "array") everyObjectIsClosed(o.items, `${path}[]`);
}

test("schema mirrors Brief and closes every object", () => {
  everyObjectIsClosed(BRIEF_SCHEMA);
  assert.deepEqual([...BRIEF_SCHEMA.required], ["headline", "recap", "lanes", "patterns", "links", "watch"]);
  assert.deepEqual([...BRIEF_SCHEMA.properties.links.items.properties.kind.enum], KINDS);
  assert.deepEqual([...BRIEF_SCHEMA.properties.lanes.items.properties.lane.enum], LANES.map((l) => l.id));
});

test("buildMockBrief covers every lane present, 3 patterns, 6 typed links", () => {
  const req = sampleRequest(30);
  const now = Date.UTC(2026, 0, 1, 12);
  const brief = buildMockBrief(req, now);
  assert.equal(brief.mock, true);
  assert.equal(brief.generatedAt, new Date(now).toISOString());
  assert.ok(brief.headline.length > 0);

  const lanesPresent = new Set(req.items.map((i) => i.lane));
  assert.deepEqual(new Set(brief.lanes.map((l) => l.lane)), lanesPresent, "one recap per lane present");
  for (const l of brief.lanes) {
    assert.ok(l.summary.length > 0);
    assert.ok(l.itemIds.length >= 1 && l.itemIds.length <= 3);
    for (const id of l.itemIds) assert.equal(req.items.find((i) => i.id === id)?.lane, l.lane, "cited ids belong to the lane");
  }

  assert.equal(brief.patterns.length, 3);
  for (const p of brief.patterns) {
    assert.ok(p.title && p.detail);
    assert.ok(p.confidence >= 0 && p.confidence <= 1);
    assert.ok(p.itemIds.length > 0);
  }

  assert.equal(brief.links.length, 6);
  const known = new Set(req.items.map((i) => i.id));
  for (const l of brief.links) {
    assert.ok(KINDS.includes(l.kind), `valid kind ${l.kind}`);
    assert.notEqual(l.source, l.target);
    assert.ok(l.label.length > 0);
    for (const id of l.itemIds) assert.ok(known.has(id), "link ids come from the request");
  }
  const bullets = brief.recap.split("\n").filter((x) => x.startsWith("- "));
  assert.ok(bullets.length >= 4 && bullets.length <= 8, `recap has 4..8 bullets (${bullets.length})`);
  assert.ok(brief.watch.length > 0 && brief.watch.length <= 8);
  assert.ok(!brief.watch.some((w) => ["opec", "lng"].includes(w.toLowerCase())), "watch suggestions skip the current watchlist");
});

test("buildMockBrief is deterministic and speaks French on request", () => {
  const req = sampleRequest(30);
  assert.deepEqual(buildMockBrief(req, 1000), buildMockBrief(req, 1000));
  const fr = buildMockBrief({ ...req, lang: "fr" }, 1000);
  assert.match(fr.recap, /titres/);
});

test("entityWords picks capitalised runs and skips stop words", () => {
  const w = entityWords("After OPEC+ meeting, Siemens Energy and the EU weigh tariff on Chinese steel");
  assert.ok(w.includes("OPEC+"));
  assert.ok(w.includes("Siemens Energy"));
  assert.ok(w.includes("Chinese"));
  assert.ok(!w.includes("After"));
});

test("validateBriefRequest rejects garbage and caps strings", () => {
  const bad: unknown[] = [
    null, 42, "x", [], {}, { items: [] }, { window: "24h", items: "nope" },
    { window: "24h", items: [{ id: "a" }] },
    { window: "24h", items: [{ id: "a", title: "t", lane: "nolane" }] },
    { window: "24h", items: [{ id: "a", title: "t", lane: "power" }, { id: "a", title: "dup", lane: "power" }] },
    { window: "", items: [{ id: "a", title: "t", lane: "power" }] },
    { window: "24h", lang: "de", items: [{ id: "a", title: "t", lane: "power" }] },
    { window: "24h", items: [{ id: "a", title: "t", lane: "power" }], patterns: "x" },
    { window: "24h", items: [{ id: "a", title: "t", lane: "power" }], watchlist: [1] },
    { window: "24h", items: Array.from({ length: 401 }, (_, i) => ({ id: `i${i}`, title: "t", lane: "power" })) },
  ];
  for (const b of bad) assert.equal(validateBriefRequest(b), null, `rejects ${JSON.stringify(b).slice(0, 60)}`);

  const ok = validateBriefRequest({
    window: "24h",
    items: [{ id: "a", title: "x".repeat(1000), lane: "oilgas", source: "s", publishedAt: "2026-01-01T00:00:00Z", region: "mena", summary: "y".repeat(2000), extra: 1 }],
    patterns: [{ title: "p", detail: "d" }],
    watchlist: [" OPEC ", "", "LNG"],
  });
  assert.ok(ok);
  assert.equal(ok.lang, "en");
  assert.equal(ok.items[0].title.length, 300);
  assert.equal(ok.items[0].summary?.length, 600);
  assert.ok(!("extra" in ok.items[0]));
  assert.deepEqual(ok.watchlist, ["OPEC", "LNG"]);
  const sample = validateBriefRequest(sampleRequest(30));
  assert.equal(sample?.items.length, 30);
});

test("normalizeBrief drops unknown ids and bad entries, keeps the shape", () => {
  const req = sampleRequest(5);
  const ids = req.items.map((i) => i.id);
  const out = normalizeBrief(
    {
      headline: "h",
      recap: "- a\n- b",
      lanes: [{ lane: "power", summary: "s", itemIds: [ids[0], "ghost"] }, { lane: "bad", summary: "s", itemIds: [] }, { lane: "oilgas", summary: "", itemIds: [] }],
      patterns: [{ title: "p", detail: "d", confidence: 7, itemIds: [ids[1]] }, { title: "", detail: "d", confidence: 0.5, itemIds: [] }],
      links: [{ source: "A", target: "B", kind: "nonsense", label: "", itemIds: [] }, { source: "A", target: "A", kind: "causes", label: "l", itemIds: [] }],
      watch: ["x", 3, "y"],
    },
    req,
    { generatedAt: "2026-01-01T00:00:00.000Z", model: "m" },
  );
  assert.ok(out);
  assert.equal(out.model, "m");
  assert.equal(out.mock, undefined);
  assert.deepEqual(out.lanes, [{ lane: "power", summary: "s", itemIds: [ids[0]] }]);
  assert.equal(out.patterns.length, 1);
  assert.equal(out.patterns[0].confidence, 1);
  assert.deepEqual(out.links, [{ source: "A", target: "B", kind: "impacts", label: "impacts", itemIds: [] }]);
  assert.deepEqual(out.watch, ["x", "y"]);
  assert.equal(normalizeBrief({ headline: "h" }, req, { generatedAt: "", model: "m" }), null);
  assert.equal(normalizeBrief("nope", req, { generatedAt: "", model: "m" }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
