import { NextResponse } from "next/server";
import { loadSources } from "@/lib/feeds";
import { mockFeeds } from "@/lib/mock";
import { FEED_BATCHES, SOURCES, sourcesForBatch } from "@/lib/sources";
import type { FeedsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_CONTROL = "public, s-maxage=120, stale-while-revalidate=600";
const MAX_BATCHES = 16;
/** A batch never runs more than ~24 feeds: 12 workers x 9s timeout stays under maxDuration. */
const MIN_BATCHES = Math.ceil(SOURCES.length / 24);
/** Keeps a single batch response well under Vercel's body limits. */
const MAX_ITEMS = 900;

function intParam(raw: string | null, fallback: number): number | null {
  if (raw === null || raw.trim() === "") return fallback;
  if (!/^-?\d{1,4}$/.test(raw.trim())) return null;
  return Number.parseInt(raw.trim(), 10);
}

function json(body: unknown, status = 200, cacheControl = CACHE_CONTROL): Response {
  return NextResponse.json(body, { status, headers: { "cache-control": cacheControl } });
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const ofRaw = intParam(params.get("of"), FEED_BATCHES);
  const batchRaw = intParam(params.get("batch"), 0);
  if (ofRaw === null || batchRaw === null) {
    return json({ error: "batch and of must be integers" }, 400, "no-store");
  }
  const of = Math.min(Math.max(ofRaw, MIN_BATCHES), MAX_BATCHES);
  const batch = Math.min(Math.max(batchRaw, 0), of - 1);
  const generatedAt = new Date().toISOString();

  if (process.env.WW_MOCK === "1") {
    return json(mockFeeds(batch, of), 200, "no-store");
  }

  const sources = sourcesForBatch(batch, of);
  try {
    const { items, statuses } = await loadSources(sources);
    const body: FeedsResponse = {
      generatedAt,
      batch,
      of,
      items: items.slice(0, MAX_ITEMS),
      sources: statuses,
    };
    // Do not let the CDN hold an all-failed response for two minutes.
    const allFailed = statuses.length > 0 && statuses.every((st) => !st.ok);
    return json(body, 200, allFailed ? "no-store" : CACHE_CONTROL);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 80) : "error";
    const body: FeedsResponse = {
      generatedAt,
      batch,
      of,
      items: [],
      sources: sources.map((s) => ({ id: s.id, name: s.name, ok: false, count: 0, ms: 0, error: message })),
    };
    return json(body, 200, "no-store");
  }
}
