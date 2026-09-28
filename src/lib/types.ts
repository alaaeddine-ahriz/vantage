export type LaneId =
  | "oilgas"
  | "power"
  | "renewables"
  | "industry"
  | "policy"
  | "markets";

export type Region =
  | "global"
  | "europe"
  | "france"
  | "mena"
  | "asia"
  | "americas"
  | "africa";

export type Lang = "en" | "fr" | "ar";

export interface Source {
  id: string;
  name: string;
  url: string;
  region: Region;
  lang: Lang;
  /** Lane used when no keyword rule matches. */
  lane: LaneId;
  /** Google News search feeds carry the real publisher inside each item. */
  kind?: "rss" | "gnews";
}

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: string;
  sourceId: string;
  source: string;
  /** Real publisher when the item came through an aggregator feed. */
  publisher?: string;
  /** titleKey(title): lets the client drop the same headline arriving from two batches. */
  key?: string;
  region: Region;
  lang: Lang;
  lanes: LaneId[];
  lane: LaneId;
}

export interface SourceStatus {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface FeedsResponse {
  generatedAt: string;
  batch: number;
  of: number;
  items: NewsItem[];
  sources: SourceStatus[];
}

export type QuoteGroup = "energy" | "metals" | "fx" | "indices" | "rates";

export interface Quote {
  id: string;
  symbol: string;
  label: string;
  group: QuoteGroup;
  price: number | null;
  change: number | null;
  changePct: number | null;
  currency?: string;
  unit?: string;
  time?: string;
  series?: number[];
  provider: "yahoo" | "stooq" | "frankfurter" | "none";
  note?: string;
}

export interface MarketsResponse {
  generatedAt: string;
  quotes: Quote[];
}

export const LANES: { id: LaneId; label: string; short: string }[] = [
  { id: "oilgas", label: "Oil & Gas", short: "O&G" },
  { id: "power", label: "Power & Grid", short: "PWR" },
  { id: "renewables", label: "Renewables & Transition", short: "RNW" },
  { id: "industry", label: "Industry & Materials", short: "IND" },
  { id: "policy", label: "Policy & Geopolitics", short: "POL" },
  { id: "markets", label: "Markets & Macro", short: "MKT" },
];

export const REGIONS: { id: Region; label: string }[] = [
  { id: "global", label: "Global" },
  { id: "europe", label: "Europe" },
  { id: "france", label: "France" },
  { id: "mena", label: "MENA" },
  { id: "asia", label: "Asia" },
  { id: "americas", label: "Americas" },
  { id: "africa", label: "Africa" },
];

export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "fr", label: "FR" },
  { id: "ar", label: "AR" },
];
