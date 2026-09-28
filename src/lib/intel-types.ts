import type { LaneId, NewsItem } from "./types";

/** Shared contract for the intelligence layer: entities, geo, graph, patterns, AI briefs. */

export type EntityKind = "country" | "company" | "commodity" | "org" | "topic";

export interface Entity {
  id: string;
  kind: EntityKind;
  label: string;
  /** ISO 3166-1 alpha-2 for countries, or the home country of a company. */
  iso2?: string;
  lat?: number;
  lng?: number;
  /** Lower-case, diacritics-folded aliases (EN and FR). */
  aliases: string[];
  sector?: LaneId;
}

/** Minimal item shape the intel engine needs (NewsItem plus a numeric timestamp). */
export interface IntelItem extends NewsItem {
  ts: number;
}

export interface GeoPoint {
  iso2: string;
  label: string;
  lat: number;
  lng: number;
  count: number;
  lanes: Partial<Record<LaneId, number>>;
  itemIds: string[];
  watchHits: number;
}

export interface Flow {
  from: string;
  to: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  count: number;
  lane: LaneId;
  itemIds: string[];
}

export type LinkKind = "cooccur" | "causes" | "impacts" | "triggers" | "responds" | "supplies";

export interface GraphNode {
  id: string;
  kind: EntityKind | "event";
  label: string;
  /** Mentions (entities) or relevance (events). */
  weight: number;
  lane?: LaneId;
  itemIds: string[];
  /** Set by the AI brief when the node was extracted by the model. */
  ai?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: LinkKind;
  weight: number;
  label?: string;
  itemIds: string[];
  ai?: boolean;
}

export type PatternKind = "spike" | "emerging" | "cluster" | "co-movement" | "ai";

export interface Pattern {
  id: string;
  kind: PatternKind;
  title: string;
  detail: string;
  /** 0..1, higher is more notable. */
  score: number;
  entityIds: string[];
  itemIds: string[];
}

export interface IntelSnapshot {
  generatedAt: string;
  entities: Record<string, Entity>;
  /** itemId -> entity ids mentioned in title or summary. */
  mentions: Record<string, string[]>;
  points: GeoPoint[];
  flows: Flow[];
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  patterns: Pattern[];
}

/** Request body for POST /api/brief. */
export interface BriefRequest {
  window: string;
  lang?: "en" | "fr";
  items: {
    id: string;
    title: string;
    source: string;
    publishedAt: string;
    lane: LaneId;
    region: string;
    summary?: string;
  }[];
  /** Optional local patterns so the model can confirm, refute or extend them. */
  patterns?: { title: string; detail: string }[];
  watchlist?: string[];
  /** Model id chosen in the UI; the server validates it against its allowlist. */
  model?: string;
}

export interface BriefLaneRecap {
  lane: LaneId;
  summary: string;
  itemIds: string[];
}

export interface BriefPattern {
  title: string;
  detail: string;
  /** 0..1 */
  confidence: number;
  itemIds: string[];
}

export interface BriefLink {
  /** Free-text labels; the client maps them to entity ids when it can. */
  source: string;
  target: string;
  kind: LinkKind;
  label: string;
  itemIds: string[];
}

export interface Brief {
  generatedAt: string;
  model: string;
  mock?: boolean;
  headline: string;
  /** Markdown, 4 to 8 short paragraphs or bullets. */
  recap: string;
  lanes: BriefLaneRecap[];
  patterns: BriefPattern[];
  links: BriefLink[];
  /** Suggested watchlist additions. */
  watch: string[];
  /** Set when the route ran without an API key and returned nothing useful. */
  error?: string;
}
