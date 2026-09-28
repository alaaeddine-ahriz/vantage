import type { Quote, QuoteGroup } from "./types";

/**
 * Market strip instruments. Yahoo Finance is the primary provider; a subset
 * has a Stooq ticker and the two majors have an ECB (Frankfurter) fallback.
 */
export interface MarketSymbol {
  id: string;
  /** Yahoo Finance ticker. */
  symbol: string;
  label: string;
  group: QuoteGroup;
  unit?: string;
  /** Shown next to the quote when the instrument is a proxy for the real benchmark. */
  note?: string;
}

export const SYMBOLS: MarketSymbol[] = [
  // Energy
  { id: "brent", symbol: "BZ=F", label: "Brent", group: "energy", unit: "USD/bbl" },
  { id: "wti", symbol: "CL=F", label: "WTI", group: "energy", unit: "USD/bbl" },
  { id: "henryhub", symbol: "NG=F", label: "Henry Hub", group: "energy", unit: "USD/MMBtu" },
  { id: "ttf", symbol: "TTF=F", label: "TTF gas", group: "energy", unit: "EUR/MWh" },
  { id: "coal", symbol: "MTF=F", label: "Coal API2", group: "energy", unit: "USD/t" },
  { id: "eua", symbol: "CO2.L", label: "EU carbon", group: "energy", unit: "EUR/t", note: "proxy: SparkChange physical EUA ETC" },
  { id: "rbob", symbol: "RB=F", label: "Gasoline", group: "energy", unit: "USD/gal" },
  { id: "heatingoil", symbol: "HO=F", label: "Heating oil", group: "energy", unit: "USD/gal" },
  // Metals
  { id: "copper", symbol: "HG=F", label: "Copper", group: "metals", unit: "USD/lb" },
  { id: "aluminium", symbol: "ALI=F", label: "Aluminium", group: "metals", unit: "USD/t" },
  { id: "hrc", symbol: "HRC=F", label: "HRC steel", group: "metals", unit: "USD/st" },
  { id: "gold", symbol: "GC=F", label: "Gold", group: "metals", unit: "USD/oz" },
  { id: "uranium", symbol: "URA", label: "Uranium ETF", group: "metals", unit: "USD", note: "proxy: Global X Uranium ETF" },
  // FX
  { id: "eurusd", symbol: "EURUSD=X", label: "EUR/USD", group: "fx" },
  { id: "gbpusd", symbol: "GBPUSD=X", label: "GBP/USD", group: "fx" },
  { id: "usdcny", symbol: "CNY=X", label: "USD/CNY", group: "fx" },
  { id: "usdjpy", symbol: "JPY=X", label: "USD/JPY", group: "fx" },
  { id: "dxy", symbol: "DX-Y.NYB", label: "Dollar idx", group: "fx" },
  // Equity indices
  { id: "spx", symbol: "^GSPC", label: "S&P 500", group: "indices" },
  { id: "sx5e", symbol: "^STOXX50E", label: "Euro Stoxx", group: "indices" },
  { id: "cac", symbol: "^FCHI", label: "CAC 40", group: "indices" },
  { id: "dax", symbol: "^GDAXI", label: "DAX", group: "indices" },
  { id: "ftse", symbol: "^FTSE", label: "FTSE 100", group: "indices" },
  { id: "nikkei", symbol: "^N225", label: "Nikkei 225", group: "indices" },
  { id: "hsi", symbol: "^HSI", label: "Hang Seng", group: "indices" },
  // Rates and volatility
  { id: "us10y", symbol: "^TNX", label: "US 10Y", group: "rates", unit: "%" },
  { id: "vix", symbol: "^VIX", label: "VIX", group: "rates" },
];

export const SYMBOL_BY_ID: Record<string, MarketSymbol> = Object.fromEntries(
  SYMBOLS.map((s) => [s.id, s]),
);

/** Stooq tickers for the subset it covers; used when Yahoo fails. */
const STOOQ: Record<string, string> = {
  brent: "cb.f",
  wti: "cl.f",
  henryhub: "ng.f",
  copper: "hg.f",
  gold: "gc.f",
  eurusd: "eurusd",
  gbpusd: "gbpusd",
  spx: "^spx",
  dax: "^dax",
  cac: "^cac",
  ftse: "^ukx",
  nikkei: "^nkx",
};

/** ECB reference rates through Frankfurter; last resort for the two majors. */
const FRANKFURTER: Record<string, { from: string; to: string }> = {
  eurusd: { from: "EUR", to: "USD" },
  gbpusd: { from: "GBP", to: "USD" },
};

const TIMEOUT_MS = 4000;
const CONCURRENCY = 8;
/** Overall budget for one loadQuotes call, well under the route's maxDuration. */
const BUDGET_MS = 22_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function emptyQuote(def: MarketSymbol): Quote {
  return {
    id: def.id,
    symbol: def.symbol,
    label: def.label,
    group: def.group,
    price: null,
    change: null,
    changePct: null,
    unit: def.unit,
    provider: "none",
    note: def.note,
  };
}

function withNote(def: MarketSymbol, providerNote?: string): string | undefined {
  const parts = [def.note, providerNote].filter((p): p is string => !!p);
  return parts.length ? parts.join("; ") : undefined;
}

/** GET with a hard timeout that also covers reading the body. */
async function fetchText(url: string, accept: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.8" },
      signal: ctrl.signal,
      redirect: "follow",
      next: { revalidate: 120 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ Yahoo Finance

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        currency?: string;
        regularMarketTime?: number;
      };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

async function fromYahoo(def: MarketSymbol): Promise<Quote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`;
  const json = JSON.parse(await fetchText(url, "application/json,text/plain,*/*")) as YahooChart;
  const result = json.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta ?? {};
  const closes = (result.indicators?.quote?.[0]?.close ?? [])
    .map(num)
    .filter((v): v is number => v !== null);

  const price = num(meta.regularMarketPrice) ?? (closes.length ? closes[closes.length - 1] : null);
  if (price === null) return null;

  // previousClose is the prior session. The second to last daily close is the
  // next best thing; chartPreviousClose is the close before the 5d window and
  // only used when nothing else exists.
  let prev = num(meta.previousClose);
  if (prev === null && closes.length >= 2) prev = closes[closes.length - 2];
  if (prev === null) prev = num(meta.chartPreviousClose);

  const change = prev !== null ? round(price - prev, 6) : null;
  const changePct = prev !== null && prev !== 0 ? round(((price - prev) / prev) * 100, 4) : null;
  const t = num(meta.regularMarketTime);
  const series = closes.length ? closes.slice(-6) : [price];
  if (series[series.length - 1] !== price) series.push(price);

  return {
    id: def.id,
    symbol: def.symbol,
    label: def.label,
    group: def.group,
    price,
    change,
    changePct,
    currency: typeof meta.currency === "string" ? meta.currency : undefined,
    unit: def.unit,
    time: t ? new Date(t * 1000).toISOString() : undefined,
    series: series.slice(-6),
    provider: "yahoo",
    note: withNote(def),
  };
}

// ------------------------------------------------------------------ Stooq

async function fromStooq(def: MarketSymbol, ticker: string): Promise<Quote | null> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(ticker)}&f=sd2t2ohlcv&h&e=csv`;
  const text = await fetchText(url, "text/csv,text/plain,*/*");
  // Symbol,Date,Time,Open,High,Low,Close,Volume
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const cols = lines[1].split(",");
  if (cols.length < 7) return null;
  const open = Number.parseFloat(cols[3]);
  const close = Number.parseFloat(cols[6]);
  if (!Number.isFinite(close)) return null;
  const hasOpen = Number.isFinite(open) && open !== 0;
  return {
    id: def.id,
    symbol: def.symbol,
    label: def.label,
    group: def.group,
    price: close,
    change: hasOpen ? round(close - open, 6) : null,
    changePct: hasOpen ? round(((close - open) / open) * 100, 4) : null,
    unit: def.unit,
    series: hasOpen ? [open, close] : [close],
    provider: "stooq",
    note: withNote(def, "vs open"),
  };
}

// ------------------------------------------------------------------ Frankfurter (ECB)

async function fromFrankfurter(def: MarketSymbol, pair: { from: string; to: string }): Promise<Quote | null> {
  const url = `https://api.frankfurter.app/latest?from=${pair.from}&to=${pair.to}`;
  const json = JSON.parse(await fetchText(url, "application/json")) as {
    date?: string;
    rates?: Record<string, number>;
  };
  const rate = num(json.rates?.[pair.to]);
  if (rate === null) return null;
  return {
    id: def.id,
    symbol: def.symbol,
    label: def.label,
    group: def.group,
    price: rate,
    change: null,
    changePct: null,
    currency: pair.to,
    unit: def.unit,
    provider: "frankfurter",
    note: withNote(def, json.date ? `ECB daily (${json.date})` : "ECB daily"),
  };
}

// ------------------------------------------------------------------ Orchestration

async function loadOne(def: MarketSymbol): Promise<Quote> {
  try {
    const q = await fromYahoo(def);
    if (q) return q;
  } catch {
    // fall through to the fallbacks
  }
  const ticker = STOOQ[def.id];
  if (ticker) {
    try {
      const q = await fromStooq(def, ticker);
      if (q) return q;
    } catch {
      // fall through
    }
  }
  const pair = FRANKFURTER[def.id];
  if (pair) {
    try {
      const q = await fromFrankfurter(def, pair);
      if (q) return q;
    } catch {
      // fall through
    }
  }
  return emptyQuote(def);
}

/** Runs fn over items with at most `limit` in flight; stops picking new items once open() is false. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  open: () => boolean,
  fn: (t: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && open()) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * Loads every symbol in SYMBOLS order within an overall budget. Never throws:
 * failures come back as provider "none", and so do symbols still pending when
 * the budget runs out, so the route answers with JSON instead of being killed
 * at maxDuration when every provider stalls to its timeout.
 */
export async function loadQuotes(budgetMs = BUDGET_MS): Promise<Quote[]> {
  const quotes = SYMBOLS.map(emptyQuote);
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, budgetMs);
  });
  const work = mapLimit(SYMBOLS, CONCURRENCY, () => !expired, async (def, i) => {
    quotes[i] = await loadOne(def).catch(() => emptyQuote(def));
  }).catch(() => undefined);
  await Promise.race([work, deadline]);
  clearTimeout(timer);
  // Snapshot: stragglers that finish later write into `quotes`, not into the response.
  return quotes.slice();
}
