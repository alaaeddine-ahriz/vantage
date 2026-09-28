import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/health: pings every upstream provider with the loaders' own headers and reports status, latency and error excerpts. */
export async function GET(): Promise<Response> {
  const report = await checkHealth();
  return NextResponse.json(report, { status: 200, headers: { "cache-control": "no-store" } });
}
