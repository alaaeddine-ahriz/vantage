import { NextResponse } from "next/server";
import { INDICATOR_BY_ID, type ScreenerData } from "@/lib/country-types";
import { loadScreener, mockScreener } from "@/lib/countrydata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

function json(body: ScreenerData, cacheControl = CACHE_CONTROL): Response {
  return NextResponse.json(body, { status: 200, headers: { "cache-control": cacheControl } });
}

export async function GET(req: Request): Promise<Response> {
  const ind = new URL(req.url).searchParams.get("ind") ?? "";
  if (!INDICATOR_BY_ID[ind]) {
    return NextResponse.json({ error: "unknown indicator id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (process.env.WW_MOCK === "1") {
    return json(mockScreener(ind), "no-store");
  }
  const data = await loadScreener(ind);
  return json(data, data.rows.length ? CACHE_CONTROL : "no-store");
}
