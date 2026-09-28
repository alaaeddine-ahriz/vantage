/**
 * Offline tests for the feed pipeline: parsing of the four feed dialects we
 * see in the wild, link cleaning, dedupe and the lane classifier.
 * Run with `npm test` (tsx, no network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classify } from "../src/lib/classify";
import { FEED_HEADERS, decodeFeedBytes, dedupe, describeHttpStatus, hashId, loadSource, parseFeedXml, stripHtml } from "../src/lib/feeds";
import { SYMBOLS, loadQuotes } from "../src/lib/markets";
import { SOURCE_BY_ID } from "../src/lib/sources";
import { titleKey } from "../src/lib/text";
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

/** Bytes of a feed body from string parts and raw byte runs. */
function bytes(...parts: Array<string | number[]>): ArrayBuffer {
  const enc = new TextEncoder();
  const all = parts.flatMap((p) => (typeof p === "string" ? [...enc.encode(p)] : p));
  return new Uint8Array(all).buffer as ArrayBuffer;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

  await test("every item carries key = titleKey(title) for cross-batch dedupe on the client", () => {
    for (const it of [...rss, ...atom, ...rdf, ...gnews]) assert.equal(it.key, titleKey(it.title));
    assert.equal(byTitle(rss, "Ørsted cancels Hornsea 4").key, "orsted cancels hornsea 4 offshore wind project after cost blowout");
  });

  // ------------------------------------------------------------ Dates
  const cet = (t: number) => new Date(t + HOUR).toUTCString().replace("GMT", "CET");
  const datesFeed = (lastBuild: number | null) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>https://example.com</link>` +
    (lastBuild === null ? "" : `<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>`) +
    `<item><title>Zone name CET is understood</title><link>https://example.com/a</link><pubDate>${cet(now - 3 * HOUR)}</pubDate></item>` +
    `<item><title>No date at all</title><link>https://example.com/b</link></item>` +
    `<item><title>Dated two hours in the future</title><link>https://example.com/c</link><pubDate>${new Date(now + 2 * HOUR).toUTCString()}</pubDate></item>` +
    `</channel></rss>`;
  const dated = await parseFeedXml(datesFeed(now - 5 * HOUR), src("offshore-energy"));
  const undated = await parseFeedXml(datesFeed(null), src("offshore-energy"));

  await test("dates: RFC 822 European zone names parse instead of falling back", () => {
    between(ageHours(byTitle(dated, "Zone name CET"), now), 2.9, 3.1, "CET item age (h)");
  });

  await test("dates: undated item takes the feed build date, or sits at the back of the 7-day window", () => {
    between(ageHours(byTitle(dated, "No date at all"), now), 4.9, 5.1, "lastBuildDate fallback age (h)");
    between(ageHours(byTitle(undated, "No date at all"), now), 7 * 24 - 0.05, 7 * 24, "no build date fallback age (h)");
  });

  await test("dates: future dates are clamped to now rather than pinned above fresh news", () => {
    const it = byTitle(dated, "Dated two hours");
    between(ageHours(it, now), -0.01, 0.05, "future item age (h)");
  });

  // ------------------------------------------------------------ Entities and charsets
  await test("stripHtml: named, hex and out-of-range references decode without throwing", () => {
    assert.equal(stripHtml("<p>Tom&rsquo;s caf&eacute;&hellip; &#x2019;&nbsp;ok</p>"), "Tom’s café… ’ ok");
    assert.doesNotThrow(() => stripHtml("&#99999999999; &#1114112; done"));
    assert.equal(stripHtml("1 &lt;b&gt; 2"), "1 <b> 2");
  });

  await test("decodeFeedBytes: BOM wins, mislabelled UTF-8 survives, genuine latin1 still decodes", () => {
    const utf8 = bytes("<rss><title>Électricité</title></rss>");
    assert.ok(decodeFeedBytes(utf8, "text/xml; charset=iso-8859-1").includes("Électricité"), "utf-8 body labelled latin1");
    const bom = bytes([0xef, 0xbb, 0xbf], '<?xml version="1.0"?><rss/>');
    assert.ok(decodeFeedBytes(bom, "text/xml; charset=windows-1252").startsWith("<?xml"), "BOM stripped, not turned into mojibake");
    const latin1 = bytes("<rss><title>caf", [0xe9], "</title></rss>");
    assert.ok(decodeFeedBytes(latin1, "text/xml; charset=iso-8859-1").includes("café"), "real latin1 with a latin1 label");
    const decl = bytes('<?xml version="1.0" encoding="ISO-8859-1"?><rss><title>caf', [0xe9], "</title></rss>");
    assert.ok(decodeFeedBytes(decl, null).includes("café"), "XML declaration used when the header has no charset");
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
  const enPolicy: Source = { ...neutral, id: "test-policy", lane: "policy" };
  const frPress: Source = { ...neutral, id: "test-fr", lang: "fr", lane: "industry" };
  const cases: Array<{ title: string; lane: LaneId; also?: LaneId[]; not?: LaneId[]; source?: Source }> = [
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
    // Acronyms: case-sensitive so folded prose does not collide, capitalised press spellings still count.
    { title: "Fed cuts rates by 25 bp", lane: "markets", not: ["oilgas"] },
    { title: "Il y a eu une explosion dans le centre-ville", lane: "industry", not: ["policy"], source: frPress },
    { title: "Pipeline fed by new wells", lane: "oilgas", not: ["markets"], source: enPolicy },
    { title: "La banque centrale relève ses taux", lane: "markets", not: ["power"], source: frPress },
    { title: "L'UE adopte un 18e paquet de sanctions", lane: "policy", source: frPress },
    { title: "Nato summit opens in The Hague", lane: "policy" },
    { title: "Eni strikes gas off Cyprus", lane: "oilgas", also: ["policy"] },
    // Bare "gas" belongs to oil & gas; "gas storage" is not battery storage.
    { title: "European gas prices jump on supply fears", lane: "markets", also: ["oilgas"] },
    { title: "EU gas storage hits 90% ahead of winter", lane: "oilgas", also: ["policy"], not: ["renewables"] },
    // Common words guarded by context.
    { title: "Dow Jones tumbles as bond yields spike", lane: "markets", not: ["industry"], source: enPolicy },
    { title: "Blue-chip stocks rally on earnings", lane: "markets", not: ["industry"], source: enPolicy },
    { title: "A court terme, le gaz restera cher", lane: "oilgas", not: ["policy"], source: frPress },
    { title: "Olive oil harvest collapses in Spain", lane: "policy", not: ["oilgas"], source: enPolicy },
    { title: "Shell company network exposed in leak", lane: "policy", not: ["oilgas"], source: enPolicy },
    { title: "Toyota charging ahead with hybrid plans", lane: "policy", not: ["renewables"], source: enPolicy },
    { title: "Réforme des retraites, au grand dam des syndicats", lane: "industry", not: ["power"], source: frPress },
    { title: "Vale of Glamorgan council approves solar farm", lane: "renewables", not: ["industry"], source: enPolicy },
    { title: "Thousands rally against pension reform in Paris", lane: "policy", not: ["markets"], source: enPolicy },
    // French-only tokens apply to French sources and never to English ones.
    { title: "Government takes action on energy bills", lane: "policy", not: ["markets"] },
    { title: "Protest marches block central Paris", lane: "policy", not: ["markets"], source: enPolicy },
    { title: "Les actions du secteur chutent", lane: "markets", source: frPress },
    { title: "Nouvelle loi sur les énergies renouvelables", lane: "renewables", also: ["policy"], source: frPress },
  ];
  for (const c of cases) {
    await test(`classify: "${c.title}" -> ${c.lane}${c.also ? " (+" + c.also.join(",") + ")" : ""}${c.not ? " (not " + c.not.join(",") + ")" : ""}`, () => {
      const r = classify(c.title, "", c.source ?? neutral);
      assert.equal(r.lane, c.lane, `lanes were ${r.lanes.join(",")}`);
      assert.ok(r.lanes.includes(c.lane));
      for (const extra of c.also ?? []) assert.ok(r.lanes.includes(extra), `lanes ${r.lanes.join(",")} should include ${extra}`);
      for (const bad of c.not ?? []) assert.ok(!r.lanes.includes(bad), `lanes ${r.lanes.join(",")} should not include ${bad}`);
    });
  }

  await test("classify: no keyword hit falls back to the source lane", () => {
    const r = classify("Weekend photo essay", "Pictures from the fair", src("bbc-world"));
    assert.deepEqual(r, { lane: "policy", lanes: ["policy"] });
  });

  // ------------------------------------------------------------ Markets budget
  await test("loadQuotes: symbols resolved within the budget are kept, stragglers come back as provider none", async () => {
    const realFetch = globalThis.fetch;
    const yahoo = (price: number) =>
      JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, previousClose: price - 1, currency: "USD" }, indicators: { quote: [{ close: [price - 1, price] }] } }] } });
    const fast = new Set(["BZ=F", "CL=F"]);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const sym = decodeURIComponent(url.split("/chart/")[1]?.split("?")[0] ?? "");
      // Slower than the budget below, faster than the provider timeout.
      if (!fast.has(sym)) await sleep(600);
      return new Response(yahoo(100), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const t0 = Date.now();
      const quotes = await loadQuotes(200);
      assert.ok(Date.now() - t0 < 550, `returned at the budget, not the provider timeout (${Date.now() - t0}ms)`);
      assert.equal(quotes.length, SYMBOLS.length);
      assert.deepEqual(quotes.map((q) => q.id), SYMBOLS.map((d) => d.id), "SYMBOLS order kept");
      assert.equal(quotes.find((q) => q.id === "brent")?.provider, "yahoo");
      assert.equal(quotes.find((q) => q.id === "wti")?.price, 100);
      assert.equal(quotes.find((q) => q.id === "henryhub")?.provider, "none", "in flight at the deadline");
      assert.equal(quotes.find((q) => q.id === "gold")?.provider, "none", "never started");
      await sleep(700);
      assert.equal(quotes.find((q) => q.id === "henryhub")?.provider, "none", "late results do not mutate the returned snapshot");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // ------------------------------------------------------------ Error surfacing
  await test("loadSource: a publisher 403 is reported as HTTP 403 (blocked), HTML pages as not a feed", async () => {
    const realFetch = globalThis.fetch;
    let sentHeaders: Record<string, string> = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      sentHeaders = (init?.headers as Record<string, string>) ?? {};
      if (url.includes("bbci")) return new Response("<html>denied</html>", { status: 403 });
      if (url.includes("oilprice")) return new Response("<!doctype html><html><body>Just a moment</body></html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    try {
      const bbc = await loadSource(src("bbc-business"));
      assert.equal(bbc.status.ok, false);
      assert.equal(bbc.status.error, "HTTP 403 (blocked)");
      assert.equal(sentHeaders, FEED_HEADERS);
      assert.match(FEED_HEADERS["user-agent"], /^Mozilla\/5\.0 \(Windows NT 10\.0.*Chrome\/\d+.* Vantage\/1\.0$/);
      const oil = await loadSource(src("oilprice"));
      assert.equal(oil.status.error, "not a feed (HTML page, likely a bot challenge)");
      const other = await loadSource(src("bbc-world") ? { ...src("bbc-world"), url: "https://example.org/x" } : src("bbc-world"));
      assert.equal(other.status.error, "HTTP 503 (unavailable)");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(describeHttpStatus(429), "HTTP 429 (rate limited)");
    assert.equal(describeHttpStatus(404), "HTTP 404 (gone)");
    assert.equal(describeHttpStatus(418), "HTTP 418");
  });

  await test("loadQuotes: every provider failing yields provider none with each HTTP status in the note", async () => {
    const realFetch = globalThis.fetch;
    const hosts: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      hosts.push(new URL(url).host);
      const h = (init?.headers as Record<string, string>) ?? {};
      assert.match(h["user-agent"] ?? "", /Chrome\//, "browser UA on every provider");
      if (url.includes("yahoo")) return new Response("Too Many Requests", { status: 429 });
      if (url.includes("stooq")) return new Response("", { status: 403 });
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    try {
      const quotes = await loadQuotes(5000);
      const brent = quotes.find((q) => q.id === "brent")!;
      assert.equal(brent.provider, "none");
      assert.equal(brent.note, "yahoo HTTP 429; stooq HTTP 403");
      const eurusd = quotes.find((q) => q.id === "eurusd")!;
      assert.equal(eurusd.note, "yahoo HTTP 429; stooq HTTP 403; frankfurter HTTP 500");
      const eua = quotes.find((q) => q.id === "eua")!;
      assert.equal(eua.note, "proxy: SparkChange physical EUA ETC; yahoo HTTP 429", "instrument note kept in front");
      assert.ok(hosts.includes("query2.finance.yahoo.com"), "second Yahoo host tried after a 429");
      assert.ok(hosts.includes("stooq.com") && hosts.includes("api.frankfurter.app"), "fallbacks actually ran");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
