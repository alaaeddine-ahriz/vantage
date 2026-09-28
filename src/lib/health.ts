import { IMF_HEADERS, BROWSER_HEADERS } from "./countrydata";
import { FEED_HEADERS } from "./feeds";
import { MARKET_HEADERS, YAHOO_HEADERS } from "./markets";
import { SOURCE_BY_ID } from "./sources";

/**
 * Upstream health: one cheap request per provider, in parallel, with the exact headers the
 * loaders send. Every check keeps the HTTP status and, on a non-2xx answer, the first characters
 * of the body, so an upstream error message ("Invalid value", a bot-wall HTML title) is reported
 * verbatim instead of a bare status. Used by /api/health and `npx tsx scripts/health.ts`.
 */

export const HEALTH_TIMEOUT_MS = 8_000;
export const EXCERPT_CHARS = 160;
/** Index of the anthropic entry in the checks list: after the six data APIs, before the RSS feeds. */
const ANTHROPIC_SLOT = 6;

export interface HealthCheck {
  id: string;
  label: string;
  /** The URL that was requested, or "" for a local check. */
  url: string;
  ok: boolean;
  /** HTTP status, or null when no response came back (timeout, DNS, TLS) or nothing was requested. */
  status: number | null;
  ms: number;
  /** Body excerpt on a non-2xx answer, the failure reason, or a short remark ("XML feed", "mock"). */
  note: string;
}

export interface HealthReport {
  generatedAt: string;
  mock?: boolean;
  checks: HealthCheck[];
}

interface Probe {
  id: string;
  label: string;
  url: string;
  headers: Record<string, string>;
  /** Judges a 2xx body; returns a note, or a failure reason prefixed with "!" */
  inspect?: (body: string, contentType: string) => string;
}

const looksLikeXml = (body: string) => /^﻿?\s*(<\?xml|<rss|<feed|<rdf:RDF)/i.test(body.slice(0, 400));
const looksLikeJson = (body: string) => /^\s*[[{]/.test(body.slice(0, 20));

function feedProbe(id: string): Probe {
  const src = SOURCE_BY_ID[id];
  return {
    id: `rss-${id}`,
    label: src ? `RSS ${src.name}` : `RSS ${id}`,
    url: src?.url ?? "",
    headers: FEED_HEADERS,
    inspect: (body) => (looksLikeXml(body) ? "XML feed" : "!200 but body is not XML (HTML challenge page?)"),
  };
}

function wbInspect(body: string): string {
  if (!looksLikeJson(body)) return "!200 but body is not JSON";
  try {
    const json = JSON.parse(body) as unknown;
    if (Array.isArray(json) && json.length === 1 && json[0] && typeof json[0] === "object" && Array.isArray((json[0] as { message?: unknown }).message)) {
      const m = (json[0] as { message: Array<{ key?: string; value?: string }> }).message[0];
      return `!World Bank error: ${m?.key ?? ""}: ${m?.value ?? ""}`.trim();
    }
    if (Array.isArray(json) && Array.isArray(json[1])) return `${json[1].length} rows`;
    return "JSON";
  } catch {
    return "!200 but JSON parse failed";
  }
}

function probes(): Probe[] {
  const year = new Date().getUTCFullYear();
  return [
    { id: "worldbank", label: "World Bank country", url: "https://api.worldbank.org/v2/country/FR?format=json", headers: BROWSER_HEADERS, inspect: wbInspect },
    {
      id: "worldbank-indicator",
      label: "World Bank indicator",
      url: `https://api.worldbank.org/v2/country/FR/indicator/NY.GDP.MKTP.CD?format=json&date=2020:${year}`,
      headers: BROWSER_HEADERS,
      inspect: wbInspect,
    },
    {
      id: "imf",
      label: "IMF datamapper",
      url: "https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/FRA",
      headers: IMF_HEADERS,
      inspect: (body) => (looksLikeJson(body) && body.includes('"values"') ? "JSON with values" : "!200 but no values in body"),
    },
    {
      id: "yahoo",
      label: "Yahoo Finance chart",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?range=5d&interval=1d",
      headers: YAHOO_HEADERS,
      inspect: (body) => (looksLikeJson(body) && body.includes('"result"') ? "JSON chart" : "!200 but no chart result"),
    },
    {
      id: "stooq",
      label: "Stooq CSV",
      url: "https://stooq.com/q/l/?s=cl.f&f=sd2t2ohlcv&h&e=csv",
      headers: { ...MARKET_HEADERS, accept: "text/csv, text/plain, */*", referer: "https://stooq.com/" },
      inspect: (body) => (/^Symbol,/i.test(body.trim()) ? "CSV" : `!200 but not CSV: ${body.slice(0, 60)}`),
    },
    {
      id: "frankfurter",
      label: "Frankfurter (ECB)",
      url: "https://api.frankfurter.app/latest?from=EUR&to=USD",
      headers: { ...MARKET_HEADERS, accept: "application/json" },
      inspect: (body) => (looksLikeJson(body) && body.includes('"rates"') ? "JSON rates" : "!200 but no rates"),
    },
    feedProbe("bbc-business"),
    feedProbe("oilprice"),
    feedProbe("lemonde-economie"),
  ];
}

function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return "request failed";
  if (err.name === "AbortError" || err.name === "TimeoutError") return `timeout after ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s`;
  const cause = (err as Error & { cause?: unknown }).cause;
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "";
  return code ? `${err.message} (${code})` : err.message || err.name;
}

async function runProbe(p: Probe): Promise<HealthCheck> {
  const t0 = Date.now();
  if (!p.url) return { id: p.id, label: p.label, url: "", ok: false, status: null, ms: 0, note: "no URL configured" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(p.url, { headers: p.headers, signal: ctrl.signal, redirect: "follow", cache: "no-store" });
    let body = "";
    try {
      body = await res.text();
    } catch {
      // status alone is still useful
    }
    const ms = Date.now() - t0;
    if (!res.ok) {
      const excerpt = body.slice(0, EXCERPT_CHARS).replace(/\s+/g, " ").trim();
      return { id: p.id, label: p.label, url: p.url, ok: false, status: res.status, ms, note: excerpt ? `HTTP ${res.status}: ${excerpt}` : `HTTP ${res.status}` };
    }
    const verdict = p.inspect ? p.inspect(body, res.headers.get("content-type") ?? "") : "";
    if (verdict.startsWith("!")) return { id: p.id, label: p.label, url: p.url, ok: false, status: res.status, ms, note: verdict.slice(1) };
    return { id: p.id, label: p.label, url: p.url, ok: true, status: res.status, ms, note: verdict };
  } catch (err) {
    return { id: p.id, label: p.label, url: p.url, ok: false, status: null, ms: Date.now() - t0, note: describeFailure(err) };
  } finally {
    clearTimeout(timer);
  }
}

function anthropicCheck(): HealthCheck {
  const set = !!process.env.ANTHROPIC_API_KEY?.trim();
  return {
    id: "anthropic",
    label: "Anthropic API key",
    url: "",
    ok: set,
    status: null,
    ms: 0,
    note: set ? "ANTHROPIC_API_KEY is set (not called)" : "ANTHROPIC_API_KEY not set: brief runs in mock mode",
  };
}

/** Pings every upstream in parallel; never throws. WW_MOCK=1 reports everything ok with note "mock". */
export async function checkHealth(): Promise<HealthReport> {
  const generatedAt = new Date().toISOString();
  const list = probes();
  const mock = process.env.WW_MOCK === "1";
  const checks: HealthCheck[] = mock
    ? list.map((p) => ({ id: p.id, label: p.label, url: p.url, ok: true, status: 200, ms: 0, note: "mock" }))
    : await Promise.all(list.map(runProbe));
  // The key check sits between the data APIs and the RSS feeds, in the same slot in both modes.
  checks.splice(ANTHROPIC_SLOT, 0, mock ? { ...anthropicCheck(), ok: true, note: "mock" } : anthropicCheck());
  return mock ? { generatedAt, mock: true, checks } : { generatedAt, checks };
}
