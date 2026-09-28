/**
 * Offline tests for the feed pipeline: parsing of the four feed dialects we
 * see in the wild, link cleaning, dedupe and the lane classifier.
 * Run with `npm test` (tsx, no network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classify } from "../src/lib/classify";
import { dedupe, hashId, parseFeedXml, titleKey } from "../src/lib/feeds";
import { SOURCE_BY_ID } from "../src/lib/sources";
import type { LaneId, NewsItem, Source } from "../src/lib/types";

const FIXTURES = path.join(__dirname, "fixtures");
const HOUR = 3_600_000;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}`);
    const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.log(text.replace(/^/gm, "    "));
  }
}

/**
 * Fixtures carry fixed dates. Shift every date tag by the same delta so the
 * newest one becomes "one hour ago"; relative ages (and the 7-day cut) hold.
 */
function shiftDates(xml: string, now: number): string {
  const re = /<(pubDate|published|updated|dc:date)>([^<]+)<\/\1>/g;
  const stamps = [...xml.matchAll(re)]
    .map((m) => Date.parse(m[2].trim()))
    .filter((t) => !Number.isNaN(t));
  const delta = now - HOUR - Math.max(...stamps);
  return xml.replace(re, (whole: string, tag: string, value: string) => {
    const t = Date.parse(value.trim());
    if (Number.isNaN(t)) return whole;
    const d = new Date(t + delta);
    return `<${tag}>${tag === "pubDate" ? d.toUTCString() : d.toISOString()}</${tag}>`;
  });
}

function src(id: string): Source {
  const s = SOURCE_BY_ID[id];
  assert.ok(s, `source ${id} exists in the catalogue`);
  return s;
}

function byTitle(items: NewsItem[], start: string): NewsItem {
  const it = items.find((i) => i.title.startsWith(start));
  assert.ok(it, `item starting with "${start}" is present in [${items.map((i) => i.title).join(" | ")}]`);
  return it;
}

const ageHours = (it: NewsItem, now: number) => (now - Date.parse(it.publishedAt)) / HOUR;

function between(v: number, lo: number, hi: number, what: string) {
  assert.ok(v >= lo && v <= hi, `${what}: expected ${lo}..${hi}, got ${v.toFixed(2)}`);
}

async function main() {
  const now = Date.now();
  const load = (name: string) => shiftDates(readFileSync(path.join(FIXTURES, name), "utf8"), now);

  const rss = await parseFeedXml(load("rss2.xml"), src("offshore-energy"));
  const atom = await parseFeedXml(load("atom.xml"), src("wnn"));
  const rdf = await parseFeedXml(load("rdf.xml"), src("dw-business"));
  const gnews = await parseFeedXml(load("gnews.xml"), src("gn-metals"));

  // ------------------------------------------------------------ RSS 2.0
  await test("rss2: 6 items in file, the one older than 7 days is dropped", () => {
    assert.equal(rss.length, 5);
    assert.ok(!rss.some((i) => i.title.startsWith("Aker BP")), "old Aker BP item was dropped");
  });

  await test("rss2: utm parameters are stripped from links and ids hash the clean link", () => {
    const it = byTitle(rss, "Ørsted cancels Hornsea 4");
    assert.equal(it.link, "https://www.offshore-energy.biz/orsted-cancels-hornsea-4-offshore-wind-project/");
    assert.ok(!it.link.includes("utm_"));
    assert.equal(it.id, hashId(it.link));
  });

  await test("rss2: content:encoded HTML becomes a plain text summary", () => {
    const it = byTitle(rss, "Ørsted cancels Hornsea 4");
    assert.ok(it.summary.startsWith("Ørsted said it will stop development"), it.summary);
    assert.ok(!/<[a-z]+/i.test(it.summary), "no tags left in summary");
    assert.ok(it.summary.length <= 260, `summary trimmed (${it.summary.length})`);
  });

  await test("rss2: entities decoded in titles, repeated title stripped from the summary", () => {
    const it = byTitle(rss, "TotalEnergies & Technip");
    assert.equal(it.title, "TotalEnergies & Technip take FID on Papua LNG");
    assert.ok(it.summary.startsWith("The $10 billion project"), it.summary);
  });

  await test("rss2: CDATA title is clean and permalink guid stands in for a missing link", () => {
    const cdata = byTitle(rss, "ArcelorMittal idles blast furnace");
    assert.equal(cdata.title, "ArcelorMittal idles blast furnace in Dunkirk as imports surge");
    const guidOnly = byTitle(rss, "Equinor starts production");
    assert.equal(guidOnly.link, "https://www.offshore-energy.biz/equinor-starts-production-johan-castberg/");
  });

  await test("rss2: RFC 822 pubDate parsed into ISO publishedAt", () => {
    const newest = byTitle(rss, "Ørsted cancels Hornsea 4");
    between(ageHours(newest, now), 0.9, 1.1, "newest item age (h)");
    const older = byTitle(rss, "Equinor starts production");
    between(ageHours(older, now), 5 * 24 + 1, 5 * 24 + 3, "5-day-old item age (h)");
    assert.match(newest.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    for (const it of rss) {
      assert.equal(it.sourceId, "offshore-energy");
      assert.equal(it.source, "Offshore Energy");
      assert.equal(it.lang, "en");
      assert.equal(it.region, "europe");
      assert.equal(it.publisher, undefined);
    }
  });

  await test("rss2: source default lane does not override a clear renewables headline", () => {
    const it = byTitle(rss, "Ørsted cancels Hornsea 4");
    assert.equal(it.lane, "renewables");
  });

  // ------------------------------------------------------------ Atom
  await test("atom: all 4 entries parsed with <link href> resolved", () => {
    assert.equal(atom.length, 4);
    const noRel = byTitle(atom, "Kazatomprom trims");
    assert.equal(noRel.link, "https://www.world-nuclear-news.org/articles/kazatomprom-trims-2026-guidance");
    const alt = byTitle(atom, "EDF restarts Flamanville");
    assert.equal(alt.link, "https://www.world-nuclear-news.org/articles/edf-restarts-flamanville-3-after-turbine-repair");
  });

  await test("atom: <published> wins over <updated>, <updated> used when alone", () => {
    // Entry 1: published 07:30, updated 09:05 (the newest stamp, shifted to now - 1h).
    between(ageHours(byTitle(atom, "EDF restarts Flamanville"), now), 2.5, 2.7, "published age (h)");
    // Entry 2 only has <updated>, 30h before the newest stamp.
    between(ageHours(byTitle(atom, "Rolls-Royce SMR"), now), 30.9, 31.1, "updated-only age (h)");
  });

  await test("atom: html summary and content are stripped to text", () => {
    const sum = byTitle(atom, "EDF restarts Flamanville");
    assert.equal(sum.summary, "The 1,650 MWe EPR was reconnected to the grid on 27 September. EDF expects full power within two weeks.");
    const content = byTitle(atom, "Poland signs contract");
    assert.ok(content.summary.startsWith("The USD 40 billion project marks the country's first nuclear plant"), content.summary);
    assert.ok(!content.summary.includes("<"), "no tags in content-derived summary");
  });

  await test("atom: nuclear headlines land in the power lane", () => {
    assert.equal(byTitle(atom, "EDF restarts Flamanville").lane, "power");
    assert.equal(byTitle(atom, "Rolls-Royce SMR").lane, "power");
  });

  // ------------------------------------------------------------ RSS 1.0 / RDF
  await test("rdf: RSS 1.0 items parsed with dc:date", () => {
    assert.equal(rdf.length, 3);
    const it = byTitle(rdf, "Thyssenkrupp Steel");
    assert.equal(it.link, "https://www.dw.com/en/thyssenkrupp-steel-to-cut-11000-jobs/a-71234501");
    between(ageHours(it, now), 0.9, 1.1, "dc:date age (h)");
    // 2026-09-25T09:30Z is 69.25h behind the newest stamp, which itself is 1h old.
    between(ageHours(byTitle(rdf, "Euro zone manufacturing PMI"), now), 70.1, 70.4, "older dc:date age (h)");
    assert.ok(it.summary.startsWith("Germany's largest steelmaker"), it.summary);
  });

  await test("rdf: lanes for steel, power prices and PMI headlines", () => {
    assert.equal(byTitle(rdf, "Thyssenkrupp Steel").lane, "industry");
    assert.equal(byTitle(rdf, "German power prices").lane, "power");
    assert.equal(byTitle(rdf, "Euro zone manufacturing PMI").lane, "industry");
  });

  // ------------------------------------------------------------ Google News
  await test("gnews: 5 items, publisher suffix removed from titles", () => {
    assert.equal(gnews.length, 5);
    for (const it of gnews) {
      assert.ok(!/ - (Reuters|Bloomberg|Financial Times|S&P Global|South China Morning Post)$/.test(it.title), it.title);
      assert.equal(it.summary, "", "aggregator items carry no summary");
      assert.equal(it.sourceId, "gn-metals");
    }
  });

  await test("gnews: publisher comes from <source>, only the last ' - ' is a separator", () => {
    const ft = byTitle(gnews, "Copper hits record high");
    assert.equal(ft.title, "Copper hits record high - and miners can't keep up");
    assert.equal(ft.publisher, "Financial Times");
    assert.equal(byTitle(gnews, "ArcelorMittal idles").publisher, "Reuters");
    assert.equal(byTitle(gnews, "China imposes export licences").publisher, "South China Morning Post");
  });

  await test("gnews: publisher falls back to the title suffix when <source> is missing", () => {
    const it = byTitle(gnews, "US raises steel");
    assert.equal(it.title, "US raises steel and aluminium tariffs to 50%");
    assert.equal(it.publisher, "S&P Global");
  });

  await test("gnews: dates and Google article links kept as is", () => {
    const it = byTitle(gnews, "Copper hits record high");
    between(ageHours(it, now), 0.9, 1.1, "newest gnews age (h)");
    assert.equal(it.link, "https://news.google.com/rss/articles/CBMiakFVX3lxTE5fY29wcGVyX3JlY29yZF9oaWdo?oc=5");
    const tariffs = byTitle(gnews, "US raises steel");
    // The wire is an industry source, so the bias keeps steel and aluminium on top of the tariff angle.
    assert.equal(tariffs.lane, "industry", tariffs.lanes.join(","));
  });

  // ------------------------------------------------------------ Dedupe
  await test("dedupe: identical headline across a direct feed and a wire keeps the direct one", () => {
    const merged = dedupe([...gnews, ...rss]);
    const hits = merged.filter((i) => titleKey(i.title) === titleKey("ArcelorMittal idles blast furnace in Dunkirk as imports surge"));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sourceId, "offshore-energy");
    assert.equal(merged.length, rss.length + gnews.length - 1);
  });

  await test("dedupe: same link twice collapses to one, output sorted newest first", () => {
    const clone: NewsItem = { ...rss[1], id: "x", title: "A completely different headline about the same story" };
    const merged = dedupe([...rss, clone]);
    assert.equal(merged.length, rss.length);
    for (let i = 1; i < merged.length; i++) {
      assert.ok(merged[i - 1].publishedAt >= merged[i].publishedAt, "sorted desc");
    }
  });

  // ------------------------------------------------------------ titleKey
  await test("titleKey: folds case, accents and punctuation", () => {
    assert.equal(titleKey("  OPEC+ agrees: to extend, output-cuts! "), "opec agrees to extend output cuts");
    assert.equal(titleKey("Électricité : RTE alerte"), "electricite rte alerte");
    assert.equal(titleKey("A".repeat(120)).length, 90);
  });

  // ------------------------------------------------------------ Classifier
  const neutral: Source = { id: "test", name: "Test", url: "https://example.com/feed", region: "global", lang: "en", lane: "markets" };
  const cases: Array<{ title: string; lane: LaneId; also?: LaneId[] }> = [
    { title: "OPEC+ agrees to extend output cuts", lane: "oilgas" },
    { title: "EDF restarts Flamanville reactor", lane: "power" },
    { title: "Ørsted cancels US offshore wind project", lane: "renewables" },
    { title: "ArcelorMittal idles blast furnace in Dunkirk", lane: "industry" },
    { title: "EU approves new sanctions package on Russian LNG", lane: "policy", also: ["oilgas"] },
    { title: "Le prix du gaz TTF grimpe de 5%", lane: "oilgas" },
    { title: "RTE alerte sur un risque de coupures d'électricité cet hiver", lane: "power" },
    { title: "Bruxelles propose de relever les droits de douane sur l'acier chinois", lane: "policy", also: ["industry"] },
    { title: "La BCE maintient ses taux directeurs inchangés", lane: "markets" },
    { title: "Glencore to shut Mount Isa copper smelter", lane: "industry" },
    { title: "Iran threatens to close Strait of Hormuz after strikes", lane: "policy" },
    { title: "Hydrogène vert : Air Liquide inaugure un électrolyseur de 200 MW en Normandie", lane: "renewables" },
    { title: "Fed signals fewer rate cuts as Treasury yields climb", lane: "markets" },
  ];
  for (const c of cases) {
    await test(`classify: "${c.title}" -> ${c.lane}${c.also ? " (+" + c.also.join(",") + ")" : ""}`, () => {
      const r = classify(c.title, "", neutral);
      assert.equal(r.lane, c.lane, `lanes were ${r.lanes.join(",")}`);
      assert.ok(r.lanes.includes(c.lane));
      for (const extra of c.also ?? []) assert.ok(r.lanes.includes(extra), `lanes ${r.lanes.join(",")} should include ${extra}`);
    });
  }

  await test("classify: no keyword hit falls back to the source lane", () => {
    const r = classify("Weekend photo essay", "Pictures from the fair", src("bbc-world"));
    assert.deepEqual(r, { lane: "policy", lanes: ["policy"] });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
