import { NextResponse } from "next/server";
import { loadCountry, mockCountry, validIso2 } from "@/lib/countrydata";
import type { CountryData } from "@/lib/country-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

function json(body: CountryData, cacheControl = CACHE_CONTROL): Response {
  return NextResponse.json(body, { status: 200, headers: { "cache-control": cacheControl } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ iso2: string }> }): Promise<Response> {
  const { iso2 } = await params;
  if (!validIso2(iso2)) {
    return NextResponse.json({ error: "iso2 must be two letters" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (process.env.WW_MOCK === "1") {
    return json(mockCountry(iso2), "no-store");
  }
  const data = await loadCountry(iso2);
  // Do not let the CDN hold an all-failed response for an hour.
  const allFailed = data.sources.wb !== "ok" && data.sources.imf !== "ok";
  return json(data, allFailed ? "no-store" : CACHE_CONTROL);
}
