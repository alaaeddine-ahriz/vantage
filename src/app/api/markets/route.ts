import { NextResponse } from "next/server";
import { SYMBOLS, emptyQuote, loadQuotes } from "@/lib/markets";
import { mockQuotes } from "@/lib/mock";
import type { MarketsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

function json(body: MarketsResponse, cacheControl = CACHE_CONTROL): Response {
  return NextResponse.json(body, { status: 200, headers: { "cache-control": cacheControl } });
}

export async function GET(): Promise<Response> {
  if (process.env.WW_MOCK === "1") {
    return json(mockQuotes(), "no-store");
  }
  const generatedAt = new Date().toISOString();
  try {
    const quotes = await loadQuotes();
    // Do not let the CDN hold an all-failed response for a minute.
    const allFailed = quotes.every((q) => q.provider === "none");
    return json({ generatedAt, quotes }, allFailed ? "no-store" : CACHE_CONTROL);
  } catch {
    // loadQuotes already swallows provider errors; this only guards the unexpected.
    return json({ generatedAt, quotes: SYMBOLS.map(emptyQuote) }, "no-store");
  }
}
