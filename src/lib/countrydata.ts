import { GAZETTEER } from "./gazetteer";
import {
  INDICATORS,
  INDICATOR_BY_ID,
  type CountryData,
  type CountryProfile,
  type IndicatorDef,
  type IndicatorSeries,
  type ScreenerData,
  type ScreenerRow,
  type SeriesPoint,
} from "./country-types";

/**
 * Country data loader: World Bank API v2 (indicators, WGI, country metadata)
 * and the IMF WEO datamapper (growth, inflation, unemployment, current
 * account, debt with projections). Both are keyless. Everything degrades to
 * partial data rather than throwing; parse helpers are exported for tests.
 */

const WB = "https://api.worldbank.org/v2";
const IMF = "https://www.imf.org/external/datamapper/api/v1";
const TIMEOUT_MS = 8000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const WB_CHUNK = 20;
const COUNTRY_START = 1995;
const WORLD_START = 2015;
const END_YEAR = 2026;
export const REVALIDATE_COUNTRY = 86_400;
export const REVALIDATE_COUNTRY_LIST = 86_400;
export const REVALIDATE_SCREENER = 21_600;

/** ISO 3166-1 alpha-2 to alpha-3; used for the IMF call and as a fallback when the World Bank country list is unavailable. */
const ISO_PAIRS =
  "AF:AFG AL:ALB DZ:DZA AS:ASM AD:AND AO:AGO AG:ATG AR:ARG AM:ARM AW:ABW AU:AUS AT:AUT AZ:AZE BS:BHS BH:BHR BD:BGD BB:BRB BY:BLR BE:BEL BZ:BLZ BJ:BEN BM:BMU BT:BTN BO:BOL BA:BIH BW:BWA BR:BRA BN:BRN BG:BGR BF:BFA BI:BDI CV:CPV KH:KHM CM:CMR CA:CAN KY:CYM CF:CAF TD:TCD CL:CHL CN:CHN CO:COL KM:COM CD:COD CG:COG CR:CRI CI:CIV HR:HRV CU:CUB CW:CUW CY:CYP CZ:CZE DK:DNK DJ:DJI DM:DMA DO:DOM EC:ECU EG:EGY SV:SLV GQ:GNQ ER:ERI EE:EST SZ:SWZ ET:ETH FO:FRO FJ:FJI FI:FIN FR:FRA PF:PYF GA:GAB GM:GMB GE:GEO DE:DEU GH:GHA GI:GIB GR:GRC GL:GRL GD:GRD GU:GUM GT:GTM GN:GIN GW:GNB GY:GUY HT:HTI HN:HND HK:HKG HU:HUN IS:ISL IN:IND ID:IDN IR:IRN IQ:IRQ IE:IRL IM:IMN IL:ISR IT:ITA JM:JAM JP:JPN JO:JOR KZ:KAZ KE:KEN KI:KIR KP:PRK KR:KOR XK:XKX KW:KWT KG:KGZ LA:LAO LV:LVA LB:LBN LS:LSO LR:LBR LY:LBY LI:LIE LT:LTU LU:LUX MO:MAC MG:MDG MW:MWI MY:MYS MV:MDV ML:MLI MT:MLT MH:MHL MR:MRT MU:MUS MX:MEX FM:FSM MD:MDA MC:MCO MN:MNG ME:MNE MA:MAR MZ:MOZ MM:MMR NA:NAM NR:NRU NP:NPL NL:NLD NC:NCL NZ:NZL NI:NIC NE:NER NG:NGA MK:MKD MP:MNP NO:NOR OM:OMN PK:PAK PW:PLW PA:PAN PG:PNG PY:PRY PE:PER PH:PHL PL:POL PT:PRT PR:PRI QA:QAT RO:ROU RU:RUS RW:RWA WS:WSM SM:SMR ST:STP SA:SAU SN:SEN RS:SRB SC:SYC SL:SLE SG:SGP SX:SXM SK:SVK SI:SVN SB:SLB SO:SOM ZA:ZAF SS:SSD ES:ESP LK:LKA KN:KNA LC:LCA MF:MAF VC:VCT SD:SDN SR:SUR SE:SWE CH:CHE SY:SYR TW:TWN TJ:TJK TZ:TZA TH:THA TL:TLS TG:TGO TO:TON TT:TTO TN:TUN TR:TUR TM:TKM TC:TCA TV:TUV UG:UGA UA:UKR AE:ARE GB:GBR US:USA UY:URY UZ:UZB VU:VUT VE:VEN VN:VNM VG:VGB VI:VIR PS:PSE YE:YEM ZM:ZMB ZW:ZWE EU:EUU";

const ISO2_TO_ISO3: Record<string, string> = {};
const ISO3_TO_ISO2: Record<string, string> = {};
for (const pair of ISO_PAIRS.split(" ")) {
  const [a2, a3] = pair.split(":");
  ISO2_TO_ISO3[a2] = a3;
  ISO3_TO_ISO2[a3] = a2;
}

/** World Bank aggregate codes, dropped from the screener when the country list is unavailable. */
const AGGREGATES = new Set(
  "WLD EUU EMU ECS ECA EAS EAP LCN LAC MEA MNA NAC SAS SSF SSA HIC LIC LMC LMY MIC UMC OED ARB CEB CSS EAR FCS HPC IBD IBT IDA IDB IDX INX LDC LTE OSS PRE PSS PST SST TEA TEC TLA TMN TSA TSS AFE AFW".split(" "),
);

// ------------------------------------------------------------------ fetch

export async function fetchJson(url: string, revalidateSec: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*", "accept-language": "en-US,en;q=0.8" },
      signal: ctrl.signal,
      redirect: "follow",
      next: { revalidate: revalidateSec },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ parsers

interface WbRow {
  code: string;
  iso2: string;
  iso3: string;
  year: number;
  value: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** World Bank error shape: a one-element array with a message list. Throws with the message. */
function throwIfWbError(json: unknown): void {
  if (Array.isArray(json) && json.length === 1 && isRecord(json[0]) && Array.isArray(json[0].message)) {
    const first = json[0].message[0];
    const text = isRecord(first) ? `${str(first.key)}: ${str(first.value)}` : "unknown error";
    throw new Error(`World Bank: ${text}`);
  }
}

/** Flattens a World Bank indicator response into rows; null values are dropped. Throws on an error response. */
export function parseWbRows(json: unknown): WbRow[] {
  throwIfWbError(json);
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) {
    throw new Error("World Bank: unexpected response shape");
  }
  const rows: WbRow[] = [];
  for (const raw of json[1]) {
    if (!isRecord(raw)) continue;
    const value = num(raw.value);
    const year = num(raw.date);
    const ind = isRecord(raw.indicator) ? str(raw.indicator.id) : "";
    if (value === null || year === null || !ind) continue;
    rows.push({
      code: ind,
      iso2: isRecord(raw.country) ? str(raw.country.id) : "",
      iso3: str(raw.countryiso3code),
      year: Math.trunc(year),
      value,
    });
  }
  return rows;
}

/** Indicator code to points sorted by year ascending, nulls dropped. Throws on an error response. */
export function parseWbIndicators(json: unknown): Map<string, SeriesPoint[]> {
  const out = new Map<string, SeriesPoint[]>();
  for (const r of parseWbRows(json)) {
    let list = out.get(r.code);
    if (!list) {
      list = [];
      out.set(r.code, list);
    }
    list.push({ year: r.year, value: r.value });
  }
  for (const list of out.values()) list.sort((a, b) => a.year - b.year);
  return out;
}

export function parseWbCountry(json: unknown): CountryProfile | null {
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) return null;
  const c = json[1][0];
  if (!isRecord(c)) return null;
  const iso2 = str(c.iso2Code).toUpperCase();
  const iso3 = str(c.id).toUpperCase();
  const name = str(c.name);
  if (!iso3 || !name) return null;
  const lat = num(c.latitude);
  const lng = num(c.longitude);
  const capital = str(c.capitalCity);
  return {
    iso2: iso2 || ISO3_TO_ISO2[iso3] || "",
    iso3,
    name,
    region: isRecord(c.region) ? str(c.region.value).trim() : "",
    incomeLevel: isRecord(c.incomeLevel) ? str(c.incomeLevel.value).trim() : "",
    capital: capital || undefined,
    lat: lat ?? undefined,
    lng: lng ?? undefined,
  };
}

export interface WbCountryMeta {
  iso2: string;
  iso3: string;
  name: string;
  region: string;
  /** False for aggregates (region id "NA"). */
  country: boolean;
}

/** World Bank country list (per_page=400). */
export function parseWbCountryList(json: unknown): WbCountryMeta[] {
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) return [];
  const out: WbCountryMeta[] = [];
  for (const c of json[1]) {
    if (!isRecord(c)) continue;
    const iso3 = str(c.id).toUpperCase();
    if (!iso3) continue;
    const regionId = isRecord(c.region) ? str(c.region.id) : "";
    out.push({
      iso2: str(c.iso2Code).toUpperCase(),
      iso3,
      name: str(c.name),
      region: isRecord(c.region) ? str(c.region.value).trim() : "",
      country: regionId !== "" && regionId !== "NA",
    });
  }
  return out;
}

function imfPoints(yearMap: unknown, currentYear: number): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  if (!isRecord(yearMap)) return points;
  for (const [y, v] of Object.entries(yearMap)) {
    const year = num(y);
    const value = num(v);
    if (year === null || value === null) continue;
    const p: SeriesPoint = { year: Math.trunc(year), value };
    if (p.year >= currentYear) p.est = true;
    points.push(p);
  }
  points.sort((a, b) => a.year - b.year);
  return points;
}

/** IMF datamapper response for one or several indicators: code to points for the given ISO3. Years >= currentYear are marked est. */
export function parseImf(json: unknown, iso3: string, currentYear: number): Map<string, SeriesPoint[]> {
  const out = new Map<string, SeriesPoint[]>();
  if (!isRecord(json) || !isRecord(json.values)) return out;
  for (const [code, byCountry] of Object.entries(json.values)) {
    if (!isRecord(byCountry)) continue;
    const points = imfPoints(byCountry[iso3], currentYear);
    if (points.length) out.set(code, points);
  }
  return out;
}

/** IMF datamapper response for one indicator, all countries: ISO3 to points. Non ISO3-looking keys (aggregates) are dropped. */
export function parseImfAll(json: unknown, code: string, currentYear: number): Map<string, SeriesPoint[]> {
  const out = new Map<string, SeriesPoint[]>();
  if (!isRecord(json) || !isRecord(json.values) || !isRecord(json.values[code])) return out;
  for (const [iso3, yearMap] of Object.entries(json.values[code] as Record<string, unknown>)) {
    if (!/^[A-Z]{3}$/.test(iso3)) continue;
    const points = imfPoints(yearMap, currentYear);
    if (points.length) out.set(iso3, points);
  }
  return out;
}

// ------------------------------------------------------------------ series helpers

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function buildSeries(id: string, points: SeriesPoint[], world?: number): IndicatorSeries {
  const actual = points.filter((p) => !p.est);
  const s: IndicatorSeries = { id, points };
  if (actual.length) s.latest = actual[actual.length - 1];
  if (actual.length > 1) s.prev = actual[actual.length - 2];
  if (world !== undefined) s.world = world;
  return s;
}

function latestValue(points: SeriesPoint[] | undefined): number | undefined {
  if (!points) return undefined;
  let best: SeriesPoint | undefined;
  for (const p of points) if (!p.est && (!best || p.year > best.year)) best = p;
  return best?.value;
}

function wbSource2(): IndicatorDef[] {
  return INDICATORS.filter((d) => d.source === "wb" && (d.wbSource ?? 2) === 2);
}
function wbWgi(): IndicatorDef[] {
  return INDICATORS.filter((d) => d.source === "wb" && d.wbSource === 3);
}
function imfDefs(): IndicatorDef[] {
  return INDICATORS.filter((d) => d.source === "imf");
}

function wbIndicatorUrl(country: string, codes: string[], source: number, from: number): string {
  return `${WB}/country/${country}/indicator/${codes.join(";")}?source=${source}&format=json&per_page=20000&date=${from}:${END_YEAR}`;
}

function wbBatches(country: string, from: number): { url: string; codes: string[] }[] {
  const out: { url: string; codes: string[] }[] = [];
  for (const codes of chunk(wbSource2().map((d) => d.code), WB_CHUNK)) {
    out.push({ url: wbIndicatorUrl(country, codes, 2, from), codes });
  }
  const wgi = wbWgi().map((d) => d.code);
  if (wgi.length) out.push({ url: wbIndicatorUrl(country, wgi, 3, from), codes: wgi });
  return out;
}

function gazetteerCountry(iso2: string) {
  const id = iso2.toLowerCase();
  return GAZETTEER.find((e) => e.kind === "country" && e.id === id) ?? GAZETTEER.find((e) => e.iso2 === iso2 && e.lat !== undefined);
}

function fallbackProfile(iso2: string): CountryProfile {
  if (iso2 === "EU") return { iso2: "EU", iso3: "EUU", name: "European Union", region: "Europe", incomeLevel: "High income", lat: 50.8, lng: 4.4 };
  const g = gazetteerCountry(iso2);
  return {
    iso2,
    iso3: ISO2_TO_ISO3[iso2] ?? "",
    name: g?.label ?? iso2,
    region: g ? guessRegion(g.lat ?? 0, g.lng ?? 0) : "",
    incomeLevel: "",
    lat: g?.lat,
    lng: g?.lng,
  };
}

// ------------------------------------------------------------------ loadCountry

export function validIso2(iso2: string): boolean {
  return /^[A-Za-z]{2}$/.test(iso2);
}

export async function loadCountry(iso2Raw: string): Promise<CountryData> {
  const generatedAt = new Date().toISOString();
  const iso2 = validIso2(iso2Raw) ? iso2Raw.toUpperCase() : "";
  if (!iso2) {
    return { generatedAt, profile: fallbackProfile("??"), series: {}, missing: INDICATORS.map((d) => d.id), sources: { wb: "skipped", imf: "skipped" } };
  }
  const wbCountry = iso2 === "EU" ? "EUU" : iso2;
  const iso3 = iso2 === "EU" ? "EU" : (ISO2_TO_ISO3[iso2] ?? iso2);
  const currentYear = new Date().getUTCFullYear();

  const batches = wbBatches(wbCountry, COUNTRY_START);
  const worldBatches = wbBatches("WLD", WORLD_START);
  const imfUrl = `${IMF}/${imfDefs().map((d) => d.code).join("/")}/${iso3}`;

  const [metaRes, imfRes, ...rest] = await Promise.allSettled([
    fetchJson(`${WB}/country/${wbCountry}?format=json`, REVALIDATE_COUNTRY),
    fetchJson(imfUrl, REVALIDATE_COUNTRY),
    ...batches.map((b) => fetchJson(b.url, REVALIDATE_COUNTRY)),
    ...worldBatches.map((b) => fetchJson(b.url, REVALIDATE_COUNTRY)),
  ]);
  const batchRes = rest.slice(0, batches.length);
  const worldRes = rest.slice(batches.length);

  // Profile
  let profile: CountryProfile | null = null;
  if (metaRes.status === "fulfilled") {
    try {
      throwIfWbError(metaRes.value);
      profile = parseWbCountry(metaRes.value);
    } catch {
      profile = null;
    }
  }
  if (!profile) profile = fallbackProfile(iso2);
  if (iso2 === "EU") profile = { ...profile, iso2: "EU", iso3: "EUU", name: "European Union", region: "Europe" };
  else {
    profile.iso2 = iso2;
    if (!profile.iso3) profile.iso3 = ISO2_TO_ISO3[iso2] ?? "";
    if (profile.lat === undefined || profile.lng === undefined) {
      const g = gazetteerCountry(iso2);
      if (g) {
        profile.lat = g.lat;
        profile.lng = g.lng;
      }
    }
  }

  // World Bank country series
  const wbPoints = new Map<string, SeriesPoint[]>();
  let wbFailed = false;
  batchRes.forEach((r) => {
    if (r.status !== "fulfilled") {
      wbFailed = true;
      return;
    }
    try {
      for (const [code, pts] of parseWbIndicators(r.value)) wbPoints.set(code, pts);
    } catch {
      wbFailed = true;
    }
  });

  // World aggregate, latest year per code
  const world = new Map<string, number>();
  for (const r of worldRes) {
    if (r.status !== "fulfilled") continue;
    try {
      for (const [code, pts] of parseWbIndicators(r.value)) {
        const v = latestValue(pts);
        if (v !== undefined) world.set(code, v);
      }
    } catch {
      // ignore: world values are decoration
    }
  }

  // IMF
  let imfPointsByCode = new Map<string, SeriesPoint[]>();
  let imfFailed = imfRes.status !== "fulfilled";
  if (imfRes.status === "fulfilled") {
    imfPointsByCode = parseImf(imfRes.value, iso3, currentYear);
    if (!isRecord(imfRes.value) || !isRecord(imfRes.value.values)) imfFailed = true;
  }

  const series: Record<string, IndicatorSeries> = {};
  const missing: string[] = [];
  for (const def of INDICATORS) {
    const points = def.source === "imf" ? imfPointsByCode.get(def.code) : wbPoints.get(def.code);
    if (!points || points.length === 0) {
      missing.push(def.id);
      continue;
    }
    series[def.id] = buildSeries(def.id, points, def.source === "wb" ? world.get(def.code) : undefined);
  }

  return {
    generatedAt,
    profile,
    series,
    missing,
    sources: { wb: wbFailed ? "failed" : "ok", imf: imfFailed ? "failed" : "ok" },
  };
}

// ------------------------------------------------------------------ loadScreener

async function loadCountryList(): Promise<Map<string, WbCountryMeta> | null> {
  try {
    const json = await fetchJson(`${WB}/country?format=json&per_page=400`, REVALIDATE_COUNTRY_LIST);
    const list = parseWbCountryList(json);
    if (!list.length) return null;
    return new Map(list.map((c) => [c.iso3, c]));
  } catch {
    return null;
  }
}

function isRealCountry(iso3: string, list: Map<string, WbCountryMeta> | null): boolean {
  if (!/^[A-Z]{3}$/.test(iso3)) return false;
  if (list) {
    const c = list.get(iso3);
    return c ? c.country : false;
  }
  return !AGGREGATES.has(iso3) && !/^\d/.test(iso3);
}

function prev5Of(points: SeriesPoint[], year: number): number | undefined {
  return points.find((p) => p.year === year - 5 && !p.est)?.value;
}

export async function loadScreener(indicatorId: string): Promise<ScreenerData> {
  const generatedAt = new Date().toISOString();
  const def = INDICATOR_BY_ID[indicatorId];
  if (!def) return { generatedAt, indicator: indicatorId, rows: [] };
  const currentYear = new Date().getUTCFullYear();

  const listP = loadCountryList();
  const byIso3 = new Map<string, { iso2: string; points: SeriesPoint[] }>();
  try {
    if (def.source === "wb") {
      const url = wbIndicatorUrl("all", [def.code], def.wbSource ?? 2, WORLD_START);
      for (const r of parseWbRows(await fetchJson(url, REVALIDATE_SCREENER))) {
        if (!r.iso3) continue;
        let e = byIso3.get(r.iso3);
        if (!e) {
          e = { iso2: r.iso2.toUpperCase(), points: [] };
          byIso3.set(r.iso3, e);
        }
        e.points.push({ year: r.year, value: r.value });
      }
    } else {
      const json = await fetchJson(`${IMF}/${def.code}`, REVALIDATE_SCREENER);
      for (const [iso3, points] of parseImfAll(json, def.code, currentYear)) {
        byIso3.set(iso3, { iso2: ISO3_TO_ISO2[iso3] ?? "", points });
      }
    }
  } catch {
    return { generatedAt, indicator: indicatorId, rows: [] };
  }
  const list = await listP;

  const rows: ScreenerRow[] = [];
  for (const [iso3, e] of byIso3) {
    if (!isRealCountry(iso3, list)) continue;
    const meta = list?.get(iso3);
    const iso2 = meta?.iso2 || e.iso2 || ISO3_TO_ISO2[iso3] || "";
    if (!iso2) continue;
    let latest: SeriesPoint | undefined;
    for (const p of e.points) if (!p.est && (!latest || p.year > latest.year)) latest = p;
    if (!latest) continue;
    const g = gazetteerCountry(iso2);
    rows.push({
      iso2,
      iso3,
      name: meta?.name || g?.label || iso3,
      region: meta?.region || (g ? guessRegion(g.lat ?? 0, g.lng ?? 0) : ""),
      value: latest.value,
      year: latest.year,
      prev5: prev5Of(e.points, latest.year),
    });
  }
  rows.sort((a, b) => b.value - a.value);
  return { generatedAt, indicator: indicatorId, rows };
}

// ------------------------------------------------------------------ mock

function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(s: number): () => number {
  let a = s || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plausible level and yearly wobble for an indicator. */
function mockRange(def: IndicatorDef, r: () => number): { base: number; step: number; min: number; max: number } {
  if (def.id === "gdp") {
    const base = Math.exp(Math.log(1e9) + r() * (Math.log(3e12) - Math.log(1e9)));
    return { base, step: base * 0.06, min: 1e8, max: 3e13 };
  }
  if (def.id === "gdp_pc") return { base: 800 + r() * 60_000, step: 1500, min: 300, max: 150_000 };
  if (def.id === "population") {
    const base = Math.exp(Math.log(1e6) + r() * (Math.log(1.4e9) - Math.log(1e6)));
    return { base, step: base * 0.012, min: 1e5, max: 2e9 };
  }
  if (def.wbSource === 3) return { base: -1.5 + r() * 3, step: 0.12, min: -2.5, max: 2.5 };
  if (def.id === "gdp_growth" || def.id === "manuf_growth") return { base: -1 + r() * 6, step: 1.8, min: -10, max: 12 };
  if (def.id === "inflation") return { base: r() * 8, step: 1.5, min: -2, max: 40 };
  if (def.id === "current_account") return { base: -6 + r() * 12, step: 1.2, min: -25, max: 30 };
  if (def.id === "gov_debt") return { base: 20 + r() * 100, step: 4, min: 5, max: 260 };
  if (def.id === "unemployment") return { base: 2 + r() * 12, step: 0.8, min: 0.5, max: 35 };
  if (def.id === "energy_use_pc") return { base: 300 + r() * 6000, step: 120, min: 100, max: 20_000 };
  if (def.id === "elec_use_pc") return { base: 200 + r() * 9000, step: 200, min: 50, max: 55_000 };
  if (def.id === "energy_intensity") return { base: 2 + r() * 6, step: 0.2, min: 1, max: 20 };
  if (def.id === "co2_pc") return { base: 0.3 + r() * 12, step: 0.3, min: 0.05, max: 40 };
  if (def.id === "tariff") return { base: 1 + r() * 10, step: 0.5, min: 0, max: 30 };
  if (def.id === "lpi") return { base: 2.2 + r() * 2, step: 0.1, min: 1, max: 5 };
  if (def.id === "rd") return { base: 0.2 + r() * 3, step: 0.1, min: 0, max: 5 };
  if (def.id === "energy_imports") return { base: -50 + r() * 130, step: 5, min: -400, max: 100 };
  if (def.id === "trade") return { base: 40 + r() * 100, step: 5, min: 10, max: 400 };
  if (def.id.endsWith("_rents")) return { base: r() * r() * 30, step: 1.2, min: 0, max: 60 };
  return { base: r() * 100, step: 3, min: 0, max: 100 };
}

function mockPoints(def: IndicatorDef, key: string, currentYear: number): SeriesPoint[] {
  const r = rng(seed(`${key}|${def.id}`));
  const range = mockRange(def, r);
  const points: SeriesPoint[] = [];
  let v = range.base;
  const lastYear = def.forecast ? Math.max(currentYear + 4, 2030) : 2024;
  for (let year = 1995; year <= lastYear; year++) {
    v += (r() - 0.48) * range.step;
    v = Math.min(range.max, Math.max(range.min, v));
    if (r() < 0.06 && year < 2024) continue; // gap, never on the last actual year
    const p: SeriesPoint = { year, value: Math.round(v * 1000) / 1000 };
    if (def.forecast && year >= currentYear) p.est = true;
    points.push(p);
  }
  return points;
}

/** Rough world region from coordinates, for mock profiles and fallbacks. */
export function guessRegion(lat: number, lng: number): string {
  if (lat > 34 && lng > -25 && lng < 45) return "Europe & Central Asia";
  if (lat > 40 && lng >= 45) return "Europe & Central Asia";
  if (lat > 12 && lat <= 40 && lng > -20 && lng < 62 && !(lat > 34 && lng < 45)) return "Middle East & North Africa";
  if (lat <= 12 && lat > -36 && lng > -20 && lng < 52) return "Sub-Saharan Africa";
  if (lat > 34 && lng <= -25 && lng > -170) return "North America";
  if (lng <= -25 && lng > -120) return "Latin America & Caribbean";
  if (lng >= 62 && lng < 92 && lat > 5) return "South Asia";
  return "East Asia & Pacific";
}

export function mockCountry(iso2Raw: string): CountryData {
  const iso2 = validIso2(iso2Raw) ? iso2Raw.toUpperCase() : "FR";
  const currentYear = new Date().getUTCFullYear();
  const profile = fallbackProfile(iso2);
  if (!profile.incomeLevel) {
    const r = rng(seed(iso2));
    profile.incomeLevel = ["Low income", "Lower middle income", "Upper middle income", "High income"][Math.floor(r() * 4)];
  }
  const series: Record<string, IndicatorSeries> = {};
  const missing: string[] = [];
  const r = rng(seed(`missing|${iso2}`));
  for (const def of INDICATORS) {
    if (r() < 0.05) {
      missing.push(def.id);
      continue;
    }
    const points = mockPoints(def, iso2, currentYear);
    const worldPts = def.source === "wb" ? mockPoints(def, "WLD", currentYear) : undefined;
    series[def.id] = buildSeries(def.id, points, worldPts ? latestValue(worldPts) : undefined);
  }
  return {
    generatedAt: new Date().toISOString(),
    profile,
    series,
    missing,
    mock: true,
    sources: { wb: "ok", imf: "ok" },
  };
}

export function mockScreener(indicatorId: string): ScreenerData {
  const generatedAt = new Date().toISOString();
  const def = INDICATOR_BY_ID[indicatorId];
  if (!def) return { generatedAt, indicator: indicatorId, rows: [], mock: true };
  const currentYear = new Date().getUTCFullYear();
  const countries = GAZETTEER.filter((e) => e.kind === "country" && e.iso2 && ISO2_TO_ISO3[e.iso2]).slice(0, 60);
  const rows: ScreenerRow[] = [];
  for (const c of countries) {
    const iso2 = c.iso2 as string;
    const points = mockPoints(def, iso2, currentYear);
    const actual = points.filter((p) => !p.est);
    const latest = actual[actual.length - 1];
    if (!latest) continue;
    rows.push({
      iso2,
      iso3: ISO2_TO_ISO3[iso2],
      name: c.label,
      region: guessRegion(c.lat ?? 0, c.lng ?? 0),
      value: latest.value,
      year: latest.year,
      prev5: prev5Of(points, latest.year),
    });
  }
  rows.sort((a, b) => b.value - a.value);
  return { generatedAt, indicator: indicatorId, rows, mock: true };
}
