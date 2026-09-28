import type { Brief, BriefLaneRecap, BriefLink, BriefPattern, BriefRequest, LinkKind } from "./intel-types";
import { LANES, type LaneId } from "./types";

/**
 * Everything the /api/brief route needs that is not HTTP: request validation,
 * the analyst prompt, the JSON schema the model must fill, response
 * normalisation and a deterministic mock brief for offline work and tests.
 */

export const BRIEF_MODEL = "claude-opus-5";
export const MAX_ITEMS = 400;
const MAX_PATTERNS_IN = 40;
const MAX_WATCH_IN = 200;
const TITLE_MAX = 300;
const SUMMARY_MAX = 600;
const SHORT_MAX = 120;
const LINK_KINDS: LinkKind[] = ["causes", "impacts", "triggers", "responds", "supplies"];
const LANE_IDS = new Set<string>(LANES.map((l) => l.id));

// ------------------------------------------------------------------ validation

const cap = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Returns a normalised request, or null when the body is not a usable BriefRequest. */
export function validateBriefRequest(raw: unknown): BriefRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > MAX_ITEMS) return null;
  const window = cap(r.window, 16);
  if (!window) return null;
  const lang = r.lang === "fr" ? "fr" : r.lang === "en" || r.lang === undefined ? "en" : null;
  if (lang === null) return null;

  const items: BriefRequest["items"] = [];
  const ids = new Set<string>();
  for (const it of r.items as unknown[]) {
    if (!it || typeof it !== "object") return null;
    const o = it as Record<string, unknown>;
    const id = cap(o.id, 64);
    const title = cap(o.title, TITLE_MAX);
    if (!id || !title || ids.has(id)) return null;
    if (typeof o.lane !== "string" || !LANE_IDS.has(o.lane)) return null;
    ids.add(id);
    const summary = cap(o.summary, SUMMARY_MAX);
    items.push({
      id,
      title,
      source: cap(o.source, SHORT_MAX) || "unknown",
      publishedAt: cap(o.publishedAt, 40),
      lane: o.lane as LaneId,
      region: cap(o.region, 24) || "global",
      ...(summary ? { summary } : {}),
    });
  }

  let patterns: BriefRequest["patterns"];
  if (r.patterns !== undefined) {
    if (!Array.isArray(r.patterns)) return null;
    patterns = [];
    for (const p of (r.patterns as unknown[]).slice(0, MAX_PATTERNS_IN)) {
      if (!p || typeof p !== "object") return null;
      const o = p as Record<string, unknown>;
      const title = cap(o.title, 200);
      if (!title) return null;
      patterns.push({ title, detail: cap(o.detail, 400) });
    }
  }

  let watchlist: string[] | undefined;
  if (r.watchlist !== undefined) {
    if (!Array.isArray(r.watchlist) || !(r.watchlist as unknown[]).every((w) => typeof w === "string")) return null;
    watchlist = (r.watchlist as string[]).map((w) => w.trim().slice(0, 60)).filter(Boolean).slice(0, MAX_WATCH_IN);
  }

  return { window, lang, items, ...(patterns ? { patterns } : {}), ...(watchlist ? { watchlist } : {}) };
}

// ------------------------------------------------------------------ prompt

export function systemPrompt(lang: "en" | "fr"): string {
  const language = lang === "fr" ? "French" : "English";
  return [
    "You are a senior market-research analyst covering energy and industry: oil and gas, power and grids, renewables and the transition, industrial materials, policy and geopolitics, and the macro backdrop.",
    "You receive a batch of recent headlines (with ids, source, age in hours, lane and region), a list of patterns a local statistical pass already detected, and the user's watchlist.",
    "Write an intelligence brief for a research desk. Rules:",
    "- Be concrete: name companies, countries, commodities, volumes, prices and dates when the headlines carry them. No filler, no generic advice.",
    "- Cite the item ids that support each statement (itemIds arrays). Never invent ids; only use ids from the batch. Prefer 2 to 6 ids per point.",
    "- Note uncertainty explicitly: single-source claims, rumours, contradictory headlines, and stale items should be flagged as such.",
    "- Confirm, refute or extend the local patterns; add patterns the statistics missed (cross-lane chains, second-order effects).",
    "- Links describe causal or structural relations between named entities (source and target are short entity labels such as 'OPEC+', 'Qatar', 'TTF', 'Siemens Energy'); label is a 3 to 8 word verb phrase.",
    "- Suggested watch terms are short, searchable strings not already on the watchlist.",
    "- The recap is Markdown made of 4 to 8 bullets ('- ' prefix), each one to two sentences, bold (**text**) allowed for the key entity. No headings, no links, no tables.",
    "- Only produce lane recaps for lanes that have items. Keep every summary under 60 words.",
    `- Write every free-text field in ${language}.`,
  ].join("\n");
}

const HOUR = 3_600_000;

function relHours(publishedAt: string, now: number): number {
  const ts = Date.parse(publishedAt);
  if (!Number.isFinite(ts)) return -1;
  return Math.round(Math.max(0, now - ts) / HOUR * 10) / 10;
}

/** Compact JSON payload: short keys keep the token count down for 250 items. */
export function userContent(req: BriefRequest, now: number): string {
  const items = req.items.map((it) => ({
    id: it.id,
    t: it.title,
    s: it.source,
    when: relHours(it.publishedAt, now),
    lane: it.lane,
    region: it.region,
    ...(it.summary ? { sum: it.summary.slice(0, 240) } : {}),
  }));
  const payload = {
    window: req.window,
    lang: req.lang ?? "en",
    note: "when = age in hours at generation time",
    items,
    localPatterns: req.patterns ?? [],
    watchlist: req.watchlist ?? [],
  };
  return JSON.stringify(payload);
}

// ------------------------------------------------------------------ schema

const idList = { type: "array", items: { type: "string" }, maxItems: 12 } as const;

/** Mirrors intel-types.Brief minus the server-filled fields (generatedAt, model, mock, error). */
export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "recap", "lanes", "patterns", "links", "watch"],
  properties: {
    headline: { type: "string", description: "One line, under 120 characters, the single most important development." },
    recap: { type: "string", description: "Markdown: 4 to 8 bullets starting with '- ', bold allowed, nothing else." },
    lanes: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lane", "summary", "itemIds"],
        properties: {
          lane: { type: "string", enum: LANES.map((l) => l.id) },
          summary: { type: "string" },
          itemIds: idList,
        },
      },
    },
    patterns: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "confidence", "itemIds"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          itemIds: idList,
        },
      },
    },
    links: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "target", "kind", "label", "itemIds"],
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          kind: { type: "string", enum: LINK_KINDS },
          label: { type: "string" },
          itemIds: idList,
        },
      },
    },
    watch: { type: "array", maxItems: 8, items: { type: "string" } },
  },
} as const;

// ------------------------------------------------------------------ normalisation

const num01 = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, max) : [];

/**
 * Turns whatever the model returned into a Brief, dropping ids that are not in the
 * request and entries that lack required fields. Returns null when the shape is unusable.
 */
export function normalizeBrief(raw: unknown, req: BriefRequest, meta: { generatedAt: string; model: string; mock?: boolean }): Brief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const headline = cap(r.headline, 200);
  const recap = cap(r.recap, 6000);
  if (!headline || !recap) return null;
  const known = new Set(req.items.map((i) => i.id));
  const ids = (v: unknown) => strList(v, 12).filter((id) => known.has(id));

  const lanes: BriefLaneRecap[] = [];
  for (const l of Array.isArray(r.lanes) ? (r.lanes as unknown[]) : []) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    if (typeof o.lane !== "string" || !LANE_IDS.has(o.lane)) continue;
    const summary = cap(o.summary, 1200);
    if (!summary) continue;
    lanes.push({ lane: o.lane as LaneId, summary, itemIds: ids(o.itemIds) });
  }

  const patterns: BriefPattern[] = [];
  for (const p of Array.isArray(r.patterns) ? (r.patterns as unknown[]).slice(0, 8) : []) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const title = cap(o.title, 200);
    if (!title) continue;
    patterns.push({ title, detail: cap(o.detail, 1200), confidence: num01(o.confidence, 0.5), itemIds: ids(o.itemIds) });
  }

  const links: BriefLink[] = [];
  for (const l of Array.isArray(r.links) ? (r.links as unknown[]).slice(0, 16) : []) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    const source = cap(o.source, 80);
    const target = cap(o.target, 80);
    if (!source || !target || source === target) continue;
    const kind = LINK_KINDS.includes(o.kind as LinkKind) ? (o.kind as LinkKind) : "impacts";
    links.push({ source, target, kind, label: cap(o.label, 120) || kind, itemIds: ids(o.itemIds) });
  }

  return {
    generatedAt: meta.generatedAt,
    model: meta.model,
    ...(meta.mock ? { mock: true } : {}),
    headline,
    recap,
    lanes,
    patterns,
    links,
    watch: strList(r.watch, 8).map((w) => w.slice(0, 60)),
  };
}

// ------------------------------------------------------------------ mock

/* Capitalised tokens that are almost never entities. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "as", "at", "by", "with", "from", "after", "before", "over", "under",
  "its", "it", "is", "are", "was", "were", "be", "has", "have", "had", "will", "would", "could", "should", "may", "might", "new", "first",
  "third", "second", "amid", "despite", "while", "into", "than", "this", "that", "these", "those", "les", "des", "une", "un", "la", "le",
  "pour", "dans", "sur", "avec", "sans", "plus", "moins", "selon", "vers", "chez", "entre", "week", "year", "quarter", "month", "says",
  "said", "us", "eu", "q1", "q2", "q3", "q4", "eur", "usd", "gbp", "cny", "mw", "gw", "bpd", "mtpa",
]);

/** Entity-ish phrases: runs of capitalised words or all-caps tokens, e.g. "Siemens Energy", "OPEC+", "QatarEnergy". */
export function entityWords(title: string): string[] {
  const out: string[] = [];
  const re = /(?:[A-Z][A-Za-z0-9&+'.-]*)(?:\s+(?:[A-Z][A-Za-z0-9&+'.-]*))*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const phrase = m[0].replace(/[.,;:'-]+$/g, "").trim();
    if (!phrase || phrase.length < 2) continue;
    if (STOP.has(phrase.toLowerCase())) continue;
    /* drop a leading stop word ("The Netherlands" stays, "After OPEC" becomes "OPEC") */
    const parts = phrase.split(/\s+/);
    while (parts.length > 1 && STOP.has(parts[0].toLowerCase())) parts.shift();
    const cleaned = parts.join(" ");
    if (cleaned.length >= 2 && !STOP.has(cleaned.toLowerCase())) out.push(cleaned.slice(0, 40));
  }
  return out;
}

function laneLabel(id: LaneId): string {
  return LANES.find((l) => l.id === id)?.label ?? id;
}

/**
 * Deterministic sample brief derived from the request. Same request, same brief:
 * no randomness, no clock beyond the `now` the caller passes.
 */
export function buildMockBrief(req: BriefRequest, now = Date.now()): Brief {
  const fr = req.lang === "fr";
  const byLane = new Map<LaneId, BriefRequest["items"]>();
  for (const it of req.items) {
    const list = byLane.get(it.lane) ?? [];
    list.push(it);
    byLane.set(it.lane, list);
  }
  /* newest first inside each lane; unparseable dates sink to the bottom */
  const ts = (it: BriefRequest["items"][number]) => Date.parse(it.publishedAt) || 0;
  const laneOrder = LANES.map((l) => l.id).filter((id) => byLane.has(id));

  const lanes: BriefLaneRecap[] = laneOrder.map((lane) => {
    const list = [...(byLane.get(lane) ?? [])].sort((a, b) => ts(b) - ts(a));
    const top = list.slice(0, 3);
    const names = top.map((t) => entityWords(t.title)[0]).filter(Boolean);
    const summary = fr
      ? `${list.length} titre${list.length > 1 ? "s" : ""} sur ${laneLabel(lane)}${names.length ? ` ; en tete : ${names.join(", ")}` : ""}. Point le plus recent : ${top[0].title}.`
      : `${list.length} headline${list.length > 1 ? "s" : ""} in ${laneLabel(lane)}${names.length ? `; leading names: ${names.join(", ")}` : ""}. Most recent: ${top[0].title}.`;
    return { lane, summary, itemIds: top.map((t) => t.id) };
  });

  /* entity frequency across the batch, used for patterns and links */
  const freq = new Map<string, { n: number; ids: string[]; lanes: Set<LaneId> }>();
  for (const it of req.items) {
    for (const w of new Set(entityWords(it.title))) {
      const e = freq.get(w) ?? { n: 0, ids: [], lanes: new Set<LaneId>() };
      e.n++;
      if (e.ids.length < 6) e.ids.push(it.id);
      e.lanes.add(it.lane);
      freq.set(w, e);
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));

  const busiest = [...byLane.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const patterns: BriefPattern[] = [];
  if (ranked.length) {
    const [w, e] = ranked[0];
    patterns.push({
      title: fr ? `Concentration autour de ${w}` : `Concentration around ${w}`,
      detail: fr
        ? `${w} apparait dans ${e.n} titre${e.n > 1 ? "s" : ""} sur ${e.lanes.size} lane${e.lanes.size > 1 ? "s" : ""}. Verifier si une seule source alimente la serie.`
        : `${w} appears in ${e.n} headline${e.n > 1 ? "s" : ""} across ${e.lanes.size} lane${e.lanes.size > 1 ? "s" : ""}. Check whether one source drives the run.`,
      confidence: Math.min(0.9, 0.4 + e.n * 0.1),
      itemIds: e.ids,
    });
  }
  if (busiest) {
    const ids = busiest[1].slice(0, 5).map((i) => i.id);
    patterns.push({
      title: fr ? `Volume eleve : ${laneLabel(busiest[0])}` : `Heavy flow: ${laneLabel(busiest[0])}`,
      detail: fr
        ? `${busiest[1].length} titres sur ${req.items.length} tombent dans cette lane dans la fenetre ${req.window}.`
        : `${busiest[1].length} of ${req.items.length} headlines land in this lane within the ${req.window} window.`,
      confidence: Math.min(0.85, busiest[1].length / Math.max(1, req.items.length) + 0.3),
      itemIds: ids,
    });
  }
  const cross = ranked.find(([, e]) => e.lanes.size >= 2) ?? ranked[1] ?? ranked[0];
  const local = req.patterns?.[0];
  patterns.push(
    cross
      ? {
          title: fr ? `Lien inter-lanes : ${cross[0]}` : `Cross-lane thread: ${cross[0]}`,
          detail: fr
            ? `${cross[0]} relie ${[...cross[1].lanes].map(laneLabel).join(" et ")}. ${local ? `Le signal local "${local.title}" va dans le meme sens.` : "Signal encore faible : une seule journee de donnees."}`
            : `${cross[0]} connects ${[...cross[1].lanes].map(laneLabel).join(" and ")}. ${local ? `The local signal "${local.title}" points the same way.` : "Still a weak signal: one window of data."}`,
          confidence: 0.45,
          itemIds: cross[1].ids,
        }
      : {
          title: fr ? "Pas de fil conducteur clair" : "No clear thread",
          detail: fr ? "Trop peu d'entites nommees pour relier les titres." : "Too few named entities to connect the headlines.",
          confidence: 0.2,
          itemIds: req.items.slice(0, 3).map((i) => i.id),
        },
  );

  const links: BriefLink[] = [];
  const labels = fr
    ? ["pese sur", "alimente", "declenche une reaction de", "repond a", "approvisionne"]
    : ["weighs on", "feeds into", "triggers a response from", "responds to", "supplies"];
  const seenPair = new Set<string>();
  /* walk pairs (i, i+1), (i, i+2), ... over the ranked entities until six distinct links exist */
  for (let step = 1; step < ranked.length && links.length < 6; step++) {
    for (let i = 0; i + step < ranked.length && links.length < 6; i++) {
      const [a, ea] = ranked[i];
      const [b, eb] = ranked[i + step];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (a === b || seenPair.has(key)) continue;
      seenPair.add(key);
      const kind = LINK_KINDS[links.length % LINK_KINDS.length];
      links.push({
        source: a,
        target: b,
        kind,
        label: labels[LINK_KINDS.indexOf(kind)],
        itemIds: [...new Set([...ea.ids.slice(0, 2), ...eb.ids.slice(0, 2)])],
      });
    }
  }

  const onList = new Set((req.watchlist ?? []).map((w) => w.toLowerCase()));
  const watch = ranked.map(([w]) => w).filter((w) => !onList.has(w.toLowerCase())).slice(0, 6);

  const lead = req.items.slice().sort((a, b) => ts(b) - ts(a))[0];
  const bullets = [
    fr ? `- **${req.items.length} titres** sur ${laneOrder.length} lanes dans la fenetre ${req.window}.` : `- **${req.items.length} headlines** across ${laneOrder.length} lanes in the ${req.window} window.`,
    ...lanes.slice(0, 5).map((l) => `- **${laneLabel(l.lane)}**: ${l.summary.split(fr ? "Point le plus recent" : "Most recent")[1]?.replace(/^\s*:\s*/, "").trim() ?? l.summary}`),
    lead ? (fr ? `- Dernier titre : ${lead.title} (${lead.source}).` : `- Latest: ${lead.title} (${lead.source}).`) : "",
    fr ? "- Exemple de brief : definissez ANTHROPIC_API_KEY pour une analyse reelle." : "- Sample brief: set ANTHROPIC_API_KEY for live analysis.",
  ].filter(Boolean).slice(0, 8);

  return {
    generatedAt: new Date(now).toISOString(),
    model: "mock",
    mock: true,
    headline: fr
      ? `${ranked[0]?.[0] ?? laneLabel(laneOrder[0])} domine la fenetre ${req.window}`
      : `${ranked[0]?.[0] ?? laneLabel(laneOrder[0])} dominates the ${req.window} window`,
    recap: bullets.join("\n"),
    lanes,
    patterns: patterns.slice(0, 3),
    links,
    watch,
  };
}
