/**
 * Offline tests for the country data layer: World Bank and IMF parsers on
 * fixtures, loadCountry and loadScreener with a stubbed global fetch, and
 * the mock generators. Run with `npm test` (tsx, no network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { INDICATORS } from "../src/lib/country-types";
import {
  loadCountry,
  loadScreener,
  mockCountry,
  mockScreener,
  parseImf,
  parseImfAll,
  parseWbCountry,
  parseWbCountryList,
  parseWbIndicators,
} from "../src/lib/countrydata";

const FIXTURES = path.join(__dirname, "fixtures");
const CURRENT_YEAR = new Date().getUTCFullYear();

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`ok - ${name}`);
    })
    .catch((err: unknown) => {
      failed++;
      console.log(`not ok - ${name}`);
      const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.log(text.replace(/^/gm, "    "));
    });
}

const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

type Route = { match: (url: string) => boolean; body?: string; status?: number; fail?: boolean };

const realFetch = globalThis.fetch;
const calls: string[] = [];

/** Routes fetch by URL substring to fixtures; unmatched URLs get a 404. */
function stubFetch(routes: Route[]): void {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const r = routes.find((x) => x.match(url));
    if (!r) return new Response("not found", { status: 404 });
    if (r.fail) throw new Error("network down");
    return new Response(r.body ?? "{}", { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const raw = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

/** Rows of a World Bank fixture restricted to one code, as the API answers a single-code request. */
function wbSingle(fixtureName: string, code: string): string {
  const json = JSON.parse(raw(fixtureName)) as [unknown, Array<{ indicator: { id: string } }>];
  return JSON.stringify([json[0], json[1].filter((r) => r.indicator.id === code)]);
}

/** Code of a single-code World Bank indicator URL, or null for a batch. */
function singleCode(url: string): string | null {
  const part = url.split("/indicator/")[1]?.split("?")[0] ?? "";
  return part && !part.includes(";") ? part : null;
}

const isBatch = (u: string) => u.includes("/indicator/") && (u.split("/indicator/")[1]?.split("?")[0] ?? "").includes(";");

function frRoutes(overrides: Route[] = []): Route[] {
  return [
    ...overrides,
    { match: (u) => u.includes("/v2/country/FR?"), body: raw("wb-country-fr.json") },
    { match: (u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=3"), body: raw("wb-wgi-fr.json") },
    { match: (u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=2"), body: raw("wb-indicators-fr.json") },
    { match: (u) => u.includes("/v2/country/WLD/indicator/") && u.includes("source=2"), body: raw("wb-indicators-wld.json") },
    { match: (u) => u.includes("/v2/country/WLD/indicator/") && u.includes("source=3"), body: raw("wb-error.json") },
    { match: (u) => u.includes("imf.org") && u.endsWith("/FRA"), body: raw("imf-fra.json") },
  ];
}

async function main(): Promise<void> {
  await test("parseWbIndicators: groups by code, sorts ascending, drops nulls", () => {
    const m = parseWbIndicators(fixture("wb-indicators-fr.json"));
    assert.deepEqual([...m.keys()].sort(), ["BX.KLT.DINV.WD.GD.ZS", "NY.GDP.MKTP.CD", "SP.POP.TOTL"]);
    const gdp = m.get("NY.GDP.MKTP.CD")!;
    assert.deepEqual(gdp.map((p) => p.year), [2020, 2021, 2022, 2023], "2024 null dropped, ascending");
    assert.equal(gdp[3].value, 3030904000000);
    assert.ok(gdp.every((p) => p.est === undefined));
  });

  await test("parseWbIndicators: error message response throws", () => {
    assert.throws(() => parseWbIndicators(fixture("wb-error.json")), /Invalid value/);
    assert.throws(() => parseWbIndicators({ nope: true }), /shape/);
  });

  await test("parseWbCountry: profile fields", () => {
    const p = parseWbCountry(fixture("wb-country-fr.json"));
    assert.ok(p);
    assert.equal(p.iso2, "FR");
    assert.equal(p.iso3, "FRA");
    assert.equal(p.name, "France");
    assert.equal(p.region, "Europe & Central Asia");
    assert.equal(p.incomeLevel, "High income");
    assert.equal(p.capital, "Paris");
    assert.ok(Math.abs((p.lat ?? 0) - 48.8566) < 1e-6);
    assert.ok(Math.abs((p.lng ?? 0) - 2.35097) < 1e-6);
    assert.equal(parseWbCountry(fixture("wb-error.json")), null);
    assert.equal(parseWbCountry([{}, []]), null);
  });

  await test("parseWbCountryList: aggregates flagged", () => {
    const list = parseWbCountryList(fixture("wb-countries.json"));
    assert.equal(list.length, 6);
    const by = new Map(list.map((c) => [c.iso3, c]));
    assert.equal(by.get("FRA")?.country, true);
    assert.equal(by.get("FRA")?.iso2, "FR");
    assert.equal(by.get("WLD")?.country, false);
    assert.equal(by.get("ARB")?.country, false);
  });

  await test("parseImf: five codes, nulls dropped, est from current year", () => {
    const m = parseImf(fixture("imf-fra.json"), "FRA", 2026);
    assert.deepEqual([...m.keys()].sort(), ["BCA_NGDPD", "GGXWDG_NGDP", "LUR", "NGDP_RPCH", "PCPIPCH"]);
    const g = m.get("NGDP_RPCH")!;
    assert.equal(g[0].year, 2019);
    assert.equal(g[g.length - 1].year, 2030);
    assert.ok(g.filter((p) => p.est).every((p) => p.year >= 2026));
    assert.ok(g.filter((p) => !p.est).every((p) => p.year < 2026));
    assert.equal(g.filter((p) => p.est).length, 5);
    const lur = m.get("LUR")!;
    assert.deepEqual(lur.map((p) => p.year), [2022, 2023, 2024, 2025, 2030], "2026 null dropped");
    const bca = m.get("BCA_NGDPD")!;
    assert.deepEqual(bca.map((p) => p.year), [2023, 2024]);
    assert.equal(parseImf(fixture("imf-fra.json"), "DEU", 2026).size, 0);
    assert.equal(parseImf({ values: null }, "FRA", 2026).size, 0);
  });

  await test("parseImfAll: drops aggregate keys", () => {
    const m = parseImfAll(fixture("imf-all-ngdp.json"), "NGDP_RPCH", 2026);
    assert.deepEqual([...m.keys()].sort(), ["ADVEC", "DEU", "FRA", "IND", "NGA", "USA"].filter((k) => k.length === 3).sort());
    assert.ok(!m.has("WEOWORLD"));
    assert.ok(!m.has("EU"));
    assert.equal(parseImfAll(fixture("imf-all-ngdp.json"), "PCPIPCH", 2026).size, 0);
  });

  await test("loadCountry: series, est points, WGI, world, missing", async () => {
    stubFetch(frRoutes());
    const d = await loadCountry("fr");
    assert.equal(d.profile.iso2, "FR");
    assert.equal(d.profile.iso3, "FRA");
    assert.equal(d.profile.name, "France");
    assert.equal(d.profile.capital, "Paris");
    assert.deepEqual(d.sources, { wb: "ok", imf: "ok" });
    assert.equal(d.mock, undefined);

    const gdp = d.series.gdp;
    assert.ok(gdp, "gdp series");
    assert.equal(gdp.latest?.year, 2023);
    assert.equal(gdp.latest?.value, 3030904000000);
    assert.equal(gdp.prev?.year, 2022);
    assert.equal(gdp.world, 105400000000000, "world latest non-null year is 2023");
    assert.equal(d.series.population.world, 8090000000);

    const growth = d.series.gdp_growth;
    assert.ok(growth, "gdp_growth series");
    assert.ok(growth.points.some((p) => p.est), "has est points");
    assert.ok(growth.latest && !growth.latest.est && growth.latest.year < CURRENT_YEAR, "latest is actual");
    assert.equal(growth.world, undefined);

    const pv = d.series.pol_stability;
    assert.ok(pv, "pol_stability series");
    assert.equal(pv.latest?.year, 2023);
    assert.equal(pv.latest?.value, 0.24);
    assert.equal(pv.prev?.value, 0.29);
    assert.ok(d.series.rule_of_law);

    const present = new Set(["gdp", "population", "fdi", "pol_stability", "rule_of_law", "gdp_growth", "inflation", "unemployment", "current_account", "gov_debt"]);
    const expectedMissing = INDICATORS.map((x) => x.id).filter((id) => !present.has(id));
    assert.deepEqual(d.missing, expectedMissing);
    for (const id of present) assert.ok(d.series[id], `${id} present`);

    // Batching: source-2 chunks of at most 10 codes, one WGI call with source=3, current year as the upper bound
    const frCalls = calls.filter((u) => u.includes("/v2/country/FR/indicator/"));
    for (const u of frCalls) {
      const codes = u.split("/indicator/")[1].split("?")[0].split(";");
      assert.ok(codes.length <= 10, `chunk size ${codes.length}`);
      assert.ok(codes.every((c) => /^[A-Z0-9.]+$/.test(c)), `codes are [A-Z0-9.] only: ${u}`);
      assert.ok(u.includes(`&date=1995:${CURRENT_YEAR}`), `date range ends this year: ${u}`);
      assert.ok(u.includes("per_page=10000"), "per_page 10000");
      assert.ok(!u.includes("%3B"), "semicolons stay literal");
      if (u.includes("source=3")) assert.deepEqual(codes, ["PV.EST", "RL.EST", "RQ.EST", "GE.EST", "CC.EST"]);
      else assert.ok(codes.every((c) => !c.endsWith(".EST")), "no WGI codes in source 2 calls");
    }
    assert.equal(frCalls.filter((u) => u.includes("source=3")).length, 1);
    assert.ok(calls.some((u) => u.includes("imf.org") && u.includes("NGDP_RPCH") && u.includes("GGXWDG_NGDP") && u.endsWith("/FRA")));
  });

  await test("loadCountry: every WB indicator call failing marks wb failed with the reason, IMF still present", async () => {
    stubFetch(frRoutes([{ match: (u) => u.includes("/v2/country/FR/indicator/"), fail: true }]));
    const d = await loadCountry("FR");
    assert.equal(d.sources.wb, "failed");
    assert.equal(d.sources.imf, "ok");
    assert.equal(d.errors?.wb, "network down");
    assert.equal(d.errors?.imf, undefined);
    assert.equal(d.fallback, undefined);
    assert.ok(d.series.gdp_growth);
    assert.ok(!d.series.gdp);
    assert.ok(!d.series.pol_stability);
    assert.ok(d.missing.includes("gdp"));
    // Every batch was retried per code before giving up
    const single = calls.filter((u) => u.includes("/v2/country/FR/indicator/") && singleCode(u));
    assert.equal(single.length, INDICATORS.filter((x) => x.source === "wb").length, "one retry per WB code");
  });

  await test("loadCountry: only source 2 down keeps WGI and stays ok with the lost codes in missing", async () => {
    stubFetch(frRoutes([{ match: (u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=2"), fail: true }]));
    const d = await loadCountry("FR");
    assert.equal(d.sources.wb, "ok", "something came back from the World Bank");
    assert.equal(d.errors?.wb, undefined, "no source-level error while data is present");
    assert.ok(d.series.pol_stability, "WGI call still parsed");
    assert.ok(!d.series.gdp);
    assert.ok(d.missing.includes("gdp"));
  });

  await test("loadCountry: a batch failing on one invalid code is retried per code and loses only that code", async () => {
    const bad = "EG.IMP.CONS.ZS";
    stubFetch(
      frRoutes([
        // Every source-2 batch answers with the World Bank error shape (one bad code poisons the whole batch)
        { match: (u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=2") && isBatch(u), body: raw("wb-error.json") },
        { match: (u) => u.includes("/v2/country/FR/indicator/") && singleCode(u) === bad, body: raw("wb-error.json") },
        {
          match: (u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=2") && singleCode(u) !== null,
          body: "",
        },
      ]),
    );
    // Single-code answers built from the fixture on the fly
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const code = url.includes("/v2/country/FR/indicator/") && url.includes("source=2") ? singleCode(url) : null;
      if (code && code !== bad) {
        calls.push(url);
        return new Response(wbSingle("wb-indicators-fr.json", code), { status: 200 });
      }
      return inner(input, init);
    }) as typeof fetch;

    const d = await loadCountry("fr");
    assert.equal(d.sources.wb, "ok");
    assert.equal(d.errors?.wb, undefined, "partial loss is not a source failure");
    assert.equal(d.series.gdp?.latest?.value, 3030904000000, "gdp recovered by the per-code retry");
    assert.ok(d.series.population && d.series.fdi, "other codes recovered");
    assert.ok(d.series.pol_stability, "WGI batch untouched");
    assert.ok(d.series.gdp_growth, "IMF untouched");
    assert.ok(d.missing.includes("energy_imports"), "the invalid code is lost");
    assert.ok(!d.missing.includes("gdp"));
    const batches = calls.filter((u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=2") && isBatch(u));
    const singles = calls.filter((u) => u.includes("/v2/country/FR/indicator/") && u.includes("source=2") && singleCode(u));
    assert.ok(batches.length >= 3, `batches first (${batches.length})`);
    assert.equal(singles.length, INDICATORS.filter((x) => x.source === "wb" && (x.wbSource ?? 2) === 2).length, "one retry per source-2 code");
    assert.ok(singles.some((u) => singleCode(u) === bad), "the bad code was retried too");
  });

  await test("loadCountry: IMF 403 falls back to the World Bank equivalents, no est points, errors.imf HTTP 403", async () => {
    stubFetch(
      frRoutes([
        { match: (u) => u.includes("imf.org"), status: 403, body: "<html>Access Denied</html>" },
        { match: (u) => u.includes("/v2/country/FR/indicator/NY.GDP.MKTP.KD.ZG;FP.CPI.TOTL.ZG"), body: raw("wb-imf-fallback-fr.json") },
      ]),
    );
    const d = await loadCountry("fr");
    assert.equal(d.sources.imf, "failed");
    assert.equal(d.errors?.imf, "HTTP 403");
    assert.equal(d.sources.wb, "ok");
    assert.equal(d.errors?.wb, undefined);
    assert.deepEqual(d.fallback, ["gdp_growth", "inflation", "unemployment", "current_account"], "gov_debt is all null in the fixture");
    assert.ok(d.missing.includes("gov_debt"));
    const g = d.series.gdp_growth;
    assert.ok(g, "gdp_growth from the World Bank");
    assert.deepEqual(g.points.map((p) => p.year), [2021, 2022, 2023]);
    assert.ok(g.points.every((p) => !p.est), "no projections on the fallback");
    assert.equal(g.latest?.value, 1.1);
    assert.equal(g.world, undefined);
    assert.equal(d.series.inflation.latest?.year, 2024);
    assert.equal(d.series.unemployment.latest?.value, 7.4);
    assert.ok(d.series.gdp, "regular WB series unaffected");
    // The IMF call carried the browser headers
    const fbCalls = calls.filter((u) => u.includes("NY.GDP.MKTP.KD.ZG"));
    assert.equal(fbCalls.length, 1, "one extra World Bank request");
    assert.ok(fbCalls[0].includes("source=2"));
    assert.ok(fbCalls[0].includes("/v2/country/FR/"));
  });

  await test("loadCountry: IMF fails and the fallback fails too: imf failed, nothing served, no fallback list", async () => {
    stubFetch(frRoutes([{ match: (u) => u.includes("imf.org"), fail: true }]));
    const d = await loadCountry("fr");
    assert.equal(d.sources.imf, "failed");
    assert.equal(d.errors?.imf, "network down");
    assert.equal(d.fallback, undefined);
    assert.ok(d.missing.includes("gdp_growth"));
    assert.ok(d.series.gdp);
  });

  await test("loadCountry: WB error body on every batch counts as failure; everything down still returns a profile", async () => {
    stubFetch(frRoutes([{ match: (u) => u.includes("/v2/country/FR/indicator/"), body: raw("wb-error.json") }]));
    const d = await loadCountry("fr");
    assert.equal(d.sources.wb, "failed");
    assert.equal(d.errors?.wb, "World Bank: Invalid value: The provided parameter value is not valid");
    assert.ok(d.series.gdp_growth);

    stubFetch([]);
    const dead = await loadCountry("fr");
    assert.deepEqual(dead.sources, { wb: "failed", imf: "failed" });
    assert.equal(dead.errors?.wb, "HTTP 404", "the World Bank reason is reported");
    assert.equal(dead.errors?.imf, "HTTP 404", "the IMF reason is reported");
    assert.equal(dead.profile.name, "France", "gazetteer fallback");
    assert.equal(dead.profile.iso3, "FRA");
    assert.equal(typeof dead.profile.lat, "number");
    assert.equal(dead.missing.length, INDICATORS.length);
  });

  await test("loadCountry: EU maps to EUU and bad iso2 is skipped", async () => {
    stubFetch([]);
    const eu = await loadCountry("eu");
    assert.equal(eu.profile.iso2, "EU");
    assert.equal(eu.profile.iso3, "EUU");
    assert.equal(eu.profile.name, "European Union");
    assert.equal(eu.profile.region, "Europe");
    assert.ok(calls.some((u) => u.includes("/v2/country/EUU/indicator/")));
    assert.ok(calls.some((u) => u.includes("/v2/country/EUU?")));

    const bad = await loadCountry("fra");
    assert.deepEqual(bad.sources, { wb: "skipped", imf: "skipped" });
    assert.equal(Object.keys(bad.series).length, 0);
  });

  await test("loadScreener: WB indicator drops aggregates, prev5, sorted desc", async () => {
    stubFetch([
      { match: (u) => u.includes("/v2/country?format=json"), body: raw("wb-countries.json") },
      { match: (u) => u.includes("/v2/country/all/indicator/NY.GDP.MKTP.CD") && u.includes("source=2"), body: raw("wb-all-gdp.json") },
    ]);
    const s = await loadScreener("gdp");
    assert.equal(s.indicator, "gdp");
    assert.deepEqual(s.rows.map((r) => r.iso3), ["USA", "DEU", "FRA", "NGA"]);
    const fr = s.rows.find((r) => r.iso3 === "FRA")!;
    assert.equal(fr.iso2, "FR");
    assert.equal(fr.name, "France");
    assert.equal(fr.region, "Europe & Central Asia");
    assert.equal(fr.year, 2023, "2024 null skipped");
    assert.equal(fr.prev5, 2790000000000);
    const us = s.rows.find((r) => r.iso3 === "USA")!;
    assert.equal(us.year, 2024);
    assert.equal(us.prev5, 21500000000000);
    assert.equal(s.rows.find((r) => r.iso3 === "DEU")!.prev5, 3970000000000);
    assert.equal(s.rows.find((r) => r.iso3 === "NGA")!.prev5, undefined);
  });

  await test("loadScreener: static aggregate set when the country list fails", async () => {
    stubFetch([
      { match: (u) => u.includes("/v2/country?format=json"), fail: true },
      { match: (u) => u.includes("/v2/country/all/indicator/NY.GDP.MKTP.CD"), body: raw("wb-all-gdp.json") },
    ]);
    const s = await loadScreener("gdp");
    assert.deepEqual(s.rows.map((r) => r.iso3), ["USA", "DEU", "FRA", "NGA"]);
    assert.equal(s.rows.find((r) => r.iso3 === "FRA")!.name, "France", "gazetteer name fallback");
  });

  await test("loadScreener: IMF indicator, WGI source, unknown id", async () => {
    stubFetch([
      { match: (u) => u.includes("/v2/country?format=json"), body: raw("wb-countries.json") },
      { match: (u) => u.includes("imf.org") && u.endsWith("/NGDP_RPCH"), body: raw("imf-all-ngdp.json") },
    ]);
    const s = await loadScreener("gdp_growth");
    // IND is a real country but not in the (short) fixture country list, so it is dropped by the authoritative filter.
    assert.deepEqual(s.rows.map((r) => r.iso3), ["NGA", "USA", "FRA", "DEU"]);
    const fr = s.rows.find((r) => r.iso3 === "FRA")!;
    assert.ok(fr.year < CURRENT_YEAR && fr.year >= 2024, "latest actual, not projection");
    assert.equal(fr.iso2, "FR");
    assert.ok(!s.rows.some((r) => r.iso3 === "WEOWORLD" || r.iso3 === "ADVEC"));

    stubFetch([
      { match: (u) => u.includes("/v2/country?format=json"), body: raw("wb-countries.json") },
      { match: (u) => u.includes("/v2/country/all/indicator/PV.EST") && u.includes("source=3"), body: raw("wb-wgi-fr.json") },
    ]);
    const w = await loadScreener("pol_stability");
    assert.equal(w.rows.length, 1);
    assert.equal(w.rows[0].value, 0.24);

    stubFetch([]);
    const none = await loadScreener("nope");
    assert.deepEqual(none.rows, []);
    assert.equal(calls.length, 0, "no fetch for an unknown id");
  });

  await test("loadScreener: IMF 403 falls back to the World Bank equivalent for all countries", async () => {
    stubFetch([
      { match: (u) => u.includes("/v2/country?format=json"), body: raw("wb-countries.json") },
      { match: (u) => u.includes("imf.org"), status: 403, body: "denied" },
      { match: (u) => u.includes("/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG") && u.includes("source=2"), body: raw("wb-all-gdp.json").replaceAll("NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD.ZG") },
    ]);
    const s = await loadScreener("gdp_growth");
    assert.equal(s.indicator, "gdp_growth");
    assert.deepEqual(s.rows.map((r) => r.iso3), ["USA", "DEU", "FRA", "NGA"], "rows from the World Bank equivalent");
    assert.ok(s.rows.every((r) => r.year < CURRENT_YEAR));
    assert.ok(calls.some((u) => u.includes("imf.org")), "IMF tried first");

    stubFetch([
      { match: (u) => u.includes("/v2/country?format=json"), body: raw("wb-countries.json") },
      { match: (u) => u.includes("imf.org"), fail: true },
      { match: (u) => u.includes("/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG"), fail: true },
    ]);
    const dead = await loadScreener("gdp_growth");
    assert.deepEqual(dead.rows, [], "both down: empty rows, no throw");
  });

  await test("mockCountry: deterministic, plausible, est points on forecasts", () => {
    const a = mockCountry("fr");
    const b = mockCountry("FR");
    assert.deepEqual({ ...a, generatedAt: "" }, { ...b, generatedAt: "" });
    assert.equal(a.mock, true);
    assert.equal(a.profile.iso2, "FR");
    assert.equal(a.profile.iso3, "FRA");
    assert.equal(a.profile.name, "France");
    assert.equal(typeof a.profile.lat, "number");
    assert.ok(a.profile.region.length > 0);
    assert.deepEqual(a.sources, { wb: "ok", imf: "ok" });
    for (const def of INDICATORS) {
      const s = a.series[def.id];
      if (!s) {
        assert.ok(a.missing.includes(def.id));
        continue;
      }
      assert.ok(s.points.length >= 20, `${def.id} has points`);
      for (let i = 1; i < s.points.length; i++) assert.ok(s.points[i].year > s.points[i - 1].year, `${def.id} sorted`);
      assert.ok(s.latest && !s.latest.est, `${def.id} latest actual`);
      if (def.forecast) {
        assert.ok(s.points.some((p) => p.est && p.year >= CURRENT_YEAR), `${def.id} est points`);
        assert.ok(s.points[s.points.length - 1].year >= 2030);
      } else {
        assert.ok(s.points.every((p) => !p.est));
        assert.equal(s.points[s.points.length - 1].year, 2024);
      }
      if (def.source === "wb") assert.equal(typeof s.world, "number", `${def.id} world`);
      if (def.wbSource === 3) assert.ok(s.points.every((p) => p.value >= -2.5 && p.value <= 2.5));
      if (def.id === "gdp") assert.ok(s.points.every((p) => p.value >= 1e8 && p.value <= 3e13));
      if (def.id === "population") assert.ok(s.points.every((p) => p.value >= 1e5 && p.value <= 2e9));
      if (def.fmt === "pct" && def.id !== "energy_imports" && def.id !== "current_account" && def.id !== "trade") {
        assert.ok(s.points.every((p) => p.value >= -10 && p.value <= 260), `${def.id} range`);
      }
    }
    assert.ok(Object.keys(a.series).length >= INDICATORS.length - 6);
    const missing = Object.keys(mockCountry("xx").series);
    assert.ok(missing.length > 0);
    assert.equal(mockCountry("zz").profile.name, "ZZ");
  });

  await test("mockScreener: 60 countries, sorted, deterministic", () => {
    const a = mockScreener("gdp_growth");
    const b = mockScreener("gdp_growth");
    assert.deepEqual(a.rows, b.rows);
    assert.equal(a.mock, true);
    assert.equal(a.indicator, "gdp_growth");
    assert.equal(a.rows.length, 60);
    for (let i = 1; i < a.rows.length; i++) assert.ok(a.rows[i].value <= a.rows[i - 1].value, "sorted desc");
    for (const r of a.rows) {
      assert.match(r.iso2, /^[A-Z]{2}$/);
      assert.match(r.iso3, /^[A-Z]{3}$/);
      assert.ok(r.name.length > 0);
      assert.ok(r.region.length > 0);
      assert.ok(r.year < CURRENT_YEAR, "latest is an actual year");
      assert.ok(r.value >= -10 && r.value <= 12);
    }
    assert.ok(a.rows.some((r) => r.prev5 !== undefined));
    assert.ok(new Set(a.rows.map((r) => r.iso2)).size === 60);
    assert.deepEqual(mockScreener("nope").rows, []);
    assert.notDeepEqual(mockScreener("gdp").rows.map((r) => r.iso2), a.rows.map((r) => r.iso2));
  });

  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
