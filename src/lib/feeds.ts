import { decodeHTML } from "entities";
import Parser from "rss-parser";
import { classify } from "./classify";
import { titleKey } from "./text";
import type { NewsItem, Source, SourceStatus } from "./types";

const FETCH_TIMEOUT_MS = 9000;
const MAX_ITEMS_PER_FEED = 60;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const SUMMARY_CHARS = 260;

type RawItem = {
  title?: string;
  link?: string;
  guid?: string;
  id?: string;
  isoDate?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  description?: string;
  "content:encoded"?: string;
  source?: unknown;
};

const parser = new Parser<Record<string, unknown>, RawItem>({
  customFields: {
    item: ["source", "published", "updated", "summary", "description"],
  },
  timeout: FETCH_TIMEOUT_MS,
});

const UA =
  "Mozilla/5.0 (compatible; Vantage/1.0; +https://github.com/alaaeddine-ahriz/world-watchout)";

export function stripHtml(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  // decodeHTML handles named, decimal and hex references and never throws on
  // out-of-range code points; \s also swallows the U+00A0 that &nbsp; becomes.
  return decodeHTML(text).replace(/\s+/g, " ").trim();
}

export function cleanLink(link: string): string {
  try {
    const u = new URL(link);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|cmpid|ncid)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return link;
  }
}

export function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** RFC 822 zone names V8 does not parse (it only knows GMT/UT/UTC and the US zones). */
const ZONES: Record<string, string> = {
  CET: "+0100",
  CEST: "+0200",
  BST: "+0100",
  WET: "+0000",
  WEST: "+0100",
  EET: "+0200",
  EEST: "+0300",
  MSK: "+0300",
  IST: "+0530",
};

/** Date.parse with the European zone names normalised; NaN when missing or unreadable. */
export function parseDate(raw: string | undefined): number {
  if (!raw) return NaN;
  const norm = raw.trim().replace(/\b(CET|CEST|BST|WET|WEST|EET|EEST|MSK|IST)$/, (m) => ZONES[m]);
  return Date.parse(norm);
}

function detectCharset(contentType: string | null, head: string): string {
  const ct = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (ct) return ct.toLowerCase();
  const xml = /encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  return (xml ?? "utf-8").toLowerCase();
}

const SINGLE_BYTE = /^(iso-8859-1|iso8859-1|latin1|windows-1252|cp1252|us-ascii|ascii)$/;

/**
 * Decodes a feed body. A UTF-8 BOM wins outright; a single-byte label is
 * often a lie on a UTF-8 body, so strict UTF-8 is tried before trusting it.
 */
export function decodeFeedBytes(buf: ArrayBuffer, contentType: string | null): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder("utf-8").decode(buf);
  const head = new TextDecoder("latin1").decode(buf.slice(0, 200));
  const charset = detectCharset(contentType, head);
  if (SINGLE_BYTE.test(charset)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      // genuinely single-byte, use the label
    }
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export async function fetchFeedText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept:
          "application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
        "accept-language": "en,fr;q=0.8",
      },
      signal: ctrl.signal,
      redirect: "follow",
      // Next.js data cache on Vercel: identical feed fetches within 4 minutes
      // are served from cache, so every visitor does not re-hit every publisher.
      next: { revalidate: 240 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return decodeFeedBytes(await res.arrayBuffer(), res.headers.get("content-type"));
  } finally {
    clearTimeout(timer);
  }
}

function publisherFromGoogleItem(raw: RawItem): string | undefined {
  const src = raw.source as unknown;
  if (!src) return undefined;
  if (typeof src === "string") return src;
  if (typeof src === "object" && src !== null) {
    const o = src as { _?: string; $?: { url?: string } };
    if (typeof o._ === "string") return o._;
  }
  return undefined;
}

export function normalizeItems(
  rawItems: RawItem[],
  source: Source,
  now = Date.now(),
  feedTs = NaN,
): NewsItem[] {
  const out: NewsItem[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS_PER_FEED)) {
    let title = stripHtml(raw.title ?? "").trim();
    if (!title) continue;
    const link = cleanLink((raw.link ?? raw.guid ?? raw.id ?? "").trim());
    if (!/^https?:\/\//i.test(link)) continue;

    let publisher: string | undefined;
    if (source.kind === "gnews") {
      publisher = publisherFromGoogleItem(raw);
      const cut = title.lastIndexOf(" - ");
      if (cut > 10) {
        publisher = publisher ?? title.slice(cut + 3).trim();
        title = title.slice(0, cut).trim();
      }
    }

    let ts = parseDate(raw.isoDate ?? raw.pubDate ?? raw.published ?? raw.updated);
    // Undated items take the feed's own build date, or else sit at the back of
    // the 7-day window, instead of being re-stamped "now" on every poll.
    if (Number.isNaN(ts)) ts = Number.isNaN(feedTs) ? now - MAX_AGE_MS + 1 : feedTs;
    if (ts > now) ts = now;
    if (now - ts > MAX_AGE_MS) continue;

    const rawSummary =
      raw.contentSnippet ??
      raw.summary ??
      raw.description ??
      raw["content:encoded"] ??
      raw.content ??
      "";
    let summary = stripHtml(String(rawSummary));
    if (source.kind === "gnews") summary = "";
    if (summary.toLowerCase().startsWith(title.toLowerCase())) {
      summary = summary.slice(title.length).replace(/^[\s:.-]+/, "");
    }
    if (summary.length > SUMMARY_CHARS) summary = summary.slice(0, SUMMARY_CHARS - 1).trimEnd() + "…";

    const { lane, lanes } = classify(title, summary, source);
    out.push({
      id: hashId(link),
      title,
      link,
      summary,
      publishedAt: new Date(ts).toISOString(),
      sourceId: source.id,
      source: source.name,
      publisher,
      key: titleKey(title),
      region: source.region,
      lang: source.lang,
      lanes,
      lane,
    });
  }
  return out;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export async function parseFeedXml(xml: string, source: Source): Promise<NewsItem[]> {
  const feed = await parser.parseString(xml);
  // rss-parser maps RSS <lastBuildDate>/<pubDate> and Atom <updated> onto these.
  const feedTs = parseDate(asString(feed.lastBuildDate) ?? asString(feed.pubDate));
  return normalizeItems((feed.items ?? []) as RawItem[], source, Date.now(), feedTs);
}

export async function loadSource(
  source: Source,
): Promise<{ status: SourceStatus; items: NewsItem[] }> {
  const t0 = Date.now();
  try {
    const xml = await fetchFeedText(source.url);
    if (!/<(rss|feed|rdf:RDF|channel)\b/i.test(xml.slice(0, 4000))) {
      throw new Error("not a feed");
    }
    const items = await parseFeedXml(xml, source);
    return {
      status: { id: source.id, name: source.name, ok: true, count: items.length, ms: Date.now() - t0 },
      items,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "timeout"
          : err.message.slice(0, 80)
        : "error";
    return {
      status: { id: source.id, name: source.name, ok: false, count: 0, ms: Date.now() - t0, error: message },
      items: [],
    };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function dedupe(items: NewsItem[]): NewsItem[] {
  const byLink = new Set<string>();
  const byTitle = new Set<string>();
  const out: NewsItem[] = [];
  // Direct publisher feeds win over aggregator copies, so sort gnews last.
  const ordered = [...items].sort((a, b) => {
    const ag = a.sourceId.startsWith("gn-") ? 1 : 0;
    const bg = b.sourceId.startsWith("gn-") ? 1 : 0;
    return ag - bg || b.publishedAt.localeCompare(a.publishedAt);
  });
  for (const it of ordered) {
    const tk = it.key ?? titleKey(it.title);
    if (byLink.has(it.link) || (tk.length > 20 && byTitle.has(tk))) continue;
    byLink.add(it.link);
    byTitle.add(tk);
    out.push(it);
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function loadSources(sources: Source[]) {
  const results = await mapLimit(sources, 12, loadSource);
  const items = dedupe(results.flatMap((r) => r.items));
  const statuses = results.map((r) => r.status);
  return { items, statuses };
}
