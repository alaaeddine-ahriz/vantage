import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { BRIEF_MODEL, BRIEF_SCHEMA, buildMockBrief, normalizeBrief, systemPrompt, userContent, validateBriefRequest } from "@/lib/brief";
import type { Brief } from "@/lib/intel-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BODY_BYTES = 1_500_000;

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const request = validateBriefRequest(raw);
  if (!request) return json({ error: "invalid BriefRequest: items (1..400) with id, title and lane are required" }, 400);

  const now = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.WW_MOCK === "1" || !apiKey) {
    const brief = buildMockBrief(request, now);
    if (!apiKey && process.env.WW_MOCK !== "1") brief.error = "ANTHROPIC_API_KEY not set";
    return json(brief);
  }

  const client = new Anthropic({ apiKey, timeout: 110_000, maxRetries: 1 });
  try {
    const response = await client.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: systemPrompt(request.lang ?? "en"), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent(request, now) }],
      output_config: { format: { type: "json_schema", schema: BRIEF_SCHEMA } },
    });
    if (response.stop_reason === "refusal") return json({ error: "the model declined this request" }, 502);
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: response.stop_reason === "max_tokens" ? "brief truncated: fewer items or a shorter window" : "model returned no JSON" }, 502);
    }
    const brief: Brief | null = normalizeBrief(parsed, request, { generatedAt: new Date().toISOString(), model: response.model || BRIEF_MODEL });
    if (!brief) return json({ error: "model output did not match the brief shape" }, 502);
    return json(brief);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY rejected" }, 401);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "rate limited, retry in a minute" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `upstream error ${err.status ?? ""}: ${err.message}`.trim() }, 502);
    const msg = err instanceof Error ? (err.name === "TimeoutError" || err.name === "AbortError" ? "timeout" : err.message) : "request failed";
    return json({ error: msg }, 502);
  }
}
