/**
 * Offline tests for the health check: report shape, per-check fields, non-2xx body excerpts,
 * network failures, body inspection and mock mode. Run with `npm test` (tsx, no network).
 */
import assert from "node:assert/strict";
import { EXCERPT_CHARS, checkHealth } from "../src/lib/health";

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

type Route = { match: (url: string) => boolean; body?: string; status?: number; fail?: boolean; contentType?: string };

const realFetch = globalThis.fetch;
const seen: { url: string; headers: Record<string, string> }[] = [];

function stubFetch(routes: Route[]): void {
  seen.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    const r = routes.find((x) => x.match(url));
    if (!r) return new Response("not found", { status: 404 });
    if (r.fail) throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.contentType ?? "text/plain" } });
  }) as typeof fetch;
}

const WB_ERROR = JSON.stringify([{ message: [{ id: "120", key: "Invalid value", value: "The provided parameter value is not valid" }] }]);
const WB_ROWS = JSON.stringify([{ page: 1, pages: 1 }, [{ indicator: { id: "NY.GDP.MKTP.CD" }, date: "2023", value: 1 }]]);
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
const IDS = ["worldbank", "worldbank-indicator", "imf", "yahoo", "stooq", "frankfurter", "anthropic", "rss-bbc-business", "rss-oilprice", "rss-lemonde-economie"];

async function main(): Promise<void> {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedMock = process.env.WW_MOCK;
  delete process.env.WW_MOCK;

  await test("shape: generatedAt plus one check per provider, in order, with every field", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    stubFetch([
      { match: (u) => u.includes("api.worldbank.org"), body: WB_ROWS, contentType: "application/json" },
      { match: (u) => u.includes("imf.org"), body: '{"values":{"NGDP_RPCH":{"FRA":{"2024":1.1}}}}', contentType: "application/json" },
      { match: (u) => u.includes("yahoo.com"), body: '{"chart":{"result":[{}]}}', contentType: "application/json" },
      { match: (u) => u.includes("stooq.com"), body: "Symbol,Date,Time,Open,High,Low,Close,Volume\nCL.F,2026-09-26,22:00:00,60,61,59,60.5,1\n" },
      { match: (u) => u.includes("frankfurter"), body: '{"rates":{"USD":1.1}}', contentType: "application/json" },
      { match: (u) => u.includes("bbci.co.uk") || u.includes("oilprice.com") || u.includes("lemonde.fr"), body: RSS, contentType: "application/rss+xml" },
    ]);
    const r = await checkHealth();
    assert.match(r.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(r.mock, undefined);
    assert.deepEqual(r.checks.map((c) => c.id), IDS);
    for (const c of r.checks) {
      assert.equal(typeof c.label, "string");
      assert.equal(typeof c.url, "string");
      assert.equal(typeof c.ok, "boolean");
      assert.ok(c.status === null || typeof c.status === "number");
      assert.equal(typeof c.ms, "number");
      assert.equal(typeof c.note, "string");
      assert.ok(c.ok, `${c.id} ok (${c.note})`);
    }
    const a = r.checks.find((c) => c.id === "anthropic")!;
    assert.equal(a.url, "", "anthropic makes no call");
    assert.ok(!seen.some((s) => s.url.includes("anthropic.com")), "no call to the Anthropic API");
    assert.match(a.note, /set/);
    assert.equal(r.checks.find((c) => c.id === "rss-bbc-business")!.note, "XML feed");
    assert.equal(r.checks.find((c) => c.id === "worldbank-indicator")!.note, "1 rows");

    // Headers: the IMF probe carries the browser and referer headers, feeds carry the feeds UA
    const imf = seen.find((s) => s.url.includes("imf.org"))!;
    assert.match(imf.headers["user-agent"], /Chrome\//);
    assert.equal(imf.headers.referer, "https://www.imf.org/external/datamapper/");
    assert.equal(imf.headers.origin, "https://www.imf.org");
    assert.equal(imf.headers.accept, "application/json, text/plain, */*");
    const bbc = seen.find((s) => s.url.includes("bbci.co.uk"))!;
    assert.match(bbc.headers["user-agent"], /Vantage\/1\.0$/);
    assert.match(bbc.headers.accept, /application\/rss\+xml/);
  });

  await test("non-2xx: status and the first 160 characters of the body are captured verbatim", async () => {
    const long = "x".repeat(500);
    stubFetch([
      { match: (u) => u.includes("imf.org"), status: 403, body: "<html><head><title>Access Denied</title></head><body>Request blocked</body></html>" },
      { match: (u) => u.includes("yahoo.com"), status: 429, body: long },
      { match: (u) => u.includes("api.worldbank.org/v2/country/FR/indicator"), status: 200, body: WB_ERROR, contentType: "application/json" },
      { match: (u) => u.includes("api.worldbank.org/v2/country/FR?"), status: 502, body: "" },
    ]);
    const r = await checkHealth();
    const imf = r.checks.find((c) => c.id === "imf")!;
    assert.equal(imf.ok, false);
    assert.equal(imf.status, 403);
    assert.equal(imf.note, "HTTP 403: <html><head><title>Access Denied</title></head><body>Request blocked</body></html>");

    const yahoo = r.checks.find((c) => c.id === "yahoo")!;
    assert.equal(yahoo.status, 429);
    assert.equal(yahoo.note, `HTTP 429: ${"x".repeat(EXCERPT_CHARS)}`, "excerpt is cut at 160 characters");

    const wbi = r.checks.find((c) => c.id === "worldbank-indicator")!;
    assert.equal(wbi.ok, false, "a 200 carrying the World Bank error shape is a failure");
    assert.equal(wbi.status, 200);
    assert.equal(wbi.note, "World Bank error: Invalid value: The provided parameter value is not valid");

    const wb = r.checks.find((c) => c.id === "worldbank")!;
    assert.equal(wb.status, 502);
    assert.equal(wb.note, "HTTP 502", "empty body: bare status");

    const stooq = r.checks.find((c) => c.id === "stooq")!;
    assert.equal(stooq.status, 404);
    assert.equal(stooq.note, "HTTP 404: not found");
  });

  await test("network failure: status null and the error code in the note; HTML on a feed URL is flagged", async () => {
    stubFetch([
      { match: (u) => u.includes("imf.org"), fail: true },
      { match: (u) => u.includes("oilprice.com"), body: "<!doctype html><html><body>Just a moment...</body></html>", contentType: "text/html" },
    ]);
    const r = await checkHealth();
    const imf = r.checks.find((c) => c.id === "imf")!;
    assert.equal(imf.ok, false);
    assert.equal(imf.status, null);
    assert.equal(imf.note, "fetch failed (ENOTFOUND)");
    const oil = r.checks.find((c) => c.id === "rss-oilprice")!;
    assert.equal(oil.ok, false);
    assert.equal(oil.status, 200);
    assert.match(oil.note, /not XML/);
  });

  await test("anthropic: reports a missing key without any request", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    stubFetch([]);
    const r = await checkHealth();
    const a = r.checks.find((c) => c.id === "anthropic")!;
    assert.equal(a.ok, false);
    assert.match(a.note, /not set/);
    assert.equal(seen.filter((s) => s.url.includes("anthropic")).length, 0);
  });

  await test("mock mode: every check ok with note mock and no fetch", async () => {
    process.env.WW_MOCK = "1";
    stubFetch([]);
    const r = await checkHealth();
    assert.equal(r.mock, true);
    assert.deepEqual(r.checks.map((c) => c.id), IDS);
    assert.ok(r.checks.every((c) => c.ok && c.note === "mock"));
    assert.equal(seen.length, 0);
    delete process.env.WW_MOCK;
  });

  globalThis.fetch = realFetch;
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedMock !== undefined) process.env.WW_MOCK = savedMock;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
