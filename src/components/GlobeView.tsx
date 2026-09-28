"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { feature } from "topojson-client";
import type { MeshPhongMaterial } from "three";
import land from "world-atlas/countries-110m.json";
import type { LaneId } from "@/lib/types";
import { LANES } from "@/lib/types";
import type { Flow, GeoPoint } from "@/lib/intel-types";
import { LANE_BY_ID, relativeTime, useMediaQuery, useNow } from "./util";
import css from "./GlobeView.module.css";

export interface GlobeViewProps {
  points: GeoPoint[];
  flows: Flow[];
  items: Map<string, { id: string; title: string; source: string; lane: LaneId; ts: number; link: string }>;
  theme: "dark" | "light";
  onSelectCountry?: (iso2: string | null) => void;
  selected?: string | null;
}

/* ---------- world-atlas: ISO 3166-1 numeric ids to alpha-2 (the 110m file carries no alpha codes) */
const NUM_TO_ISO2: Record<string, string> = {
  "004": "AF", "008": "AL", "010": "AQ", "012": "DZ", "024": "AO", "031": "AZ", "032": "AR", "036": "AU",
  "040": "AT", "044": "BS", "050": "BD", "051": "AM", "056": "BE", "064": "BT", "068": "BO", "070": "BA",
  "072": "BW", "076": "BR", "084": "BZ", "090": "SB", "096": "BN", "100": "BG", "104": "MM", "108": "BI",
  "112": "BY", "116": "KH", "120": "CM", "124": "CA", "140": "CF", "144": "LK", "148": "TD", "152": "CL",
  "156": "CN", "158": "TW", "170": "CO", "178": "CG", "180": "CD", "188": "CR", "191": "HR", "192": "CU",
  "196": "CY", "203": "CZ", "204": "BJ", "208": "DK", "214": "DO", "218": "EC", "222": "SV", "226": "GQ",
  "231": "ET", "232": "ER", "233": "EE", "238": "FK", "242": "FJ", "246": "FI", "250": "FR", "260": "TF",
  "262": "DJ", "266": "GA", "268": "GE", "270": "GM", "275": "PS", "276": "DE", "288": "GH", "300": "GR",
  "304": "GL", "320": "GT", "324": "GN", "328": "GY", "332": "HT", "340": "HN", "348": "HU", "352": "IS",
  "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE", "376": "IL", "380": "IT", "384": "CI",
  "388": "JM", "392": "JP", "398": "KZ", "400": "JO", "404": "KE", "408": "KP", "410": "KR", "414": "KW",
  "417": "KG", "418": "LA", "422": "LB", "426": "LS", "428": "LV", "430": "LR", "434": "LY", "440": "LT",
  "442": "LU", "450": "MG", "454": "MW", "458": "MY", "466": "ML", "478": "MR", "484": "MX", "496": "MN",
  "498": "MD", "499": "ME", "504": "MA", "508": "MZ", "512": "OM", "516": "NA", "524": "NP", "528": "NL",
  "540": "NC", "548": "VU", "554": "NZ", "558": "NI", "562": "NE", "566": "NG", "578": "NO", "586": "PK",
  "591": "PA", "598": "PG", "600": "PY", "604": "PE", "608": "PH", "616": "PL", "620": "PT", "624": "GW", "626": "TL",
  "630": "PR", "634": "QA", "642": "RO", "643": "RU", "646": "RW", "682": "SA", "686": "SN", "688": "RS",
  "694": "SL", "703": "SK", "704": "VN", "705": "SI", "706": "SO", "710": "ZA", "716": "ZW", "724": "ES", "728": "SS",
  "729": "SD", "732": "EH", "740": "SR", "748": "SZ", "752": "SE", "756": "CH", "760": "SY", "762": "TJ",
  "764": "TH", "768": "TG", "780": "TT", "784": "AE", "788": "TN", "792": "TR", "795": "TM", "800": "UG",
  "804": "UA", "807": "MK", "818": "EG", "826": "GB", "834": "TZ", "840": "US", "854": "BF", "858": "UY",
  "860": "UZ", "862": "VE", "887": "YE", "894": "ZM",
};
/* geometries without a numeric id in the atlas */
const NAME_TO_ISO2: Record<string, string> = { Kosovo: "XK" };

interface CountryProps { name: string; iso2: string; lat: number; lng: number }
type CountryFeature = Feature<Polygon | MultiPolygon, CountryProps>;

/** Rough centre of the largest ring: enough to fly the camera to a country. */
function centreOf(geom: Polygon | MultiPolygon): { lat: number; lng: number } {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let best: number[][] = [];
  for (const p of polys) if (p[0] && p[0].length > best.length) best = p[0];
  if (!best.length) return { lat: 0, lng: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of best) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 };
}

let countriesCache: CountryFeature[] | null = null;
/** Decoded once per page; the JSON is bundled, nothing is fetched. */
function countries(): CountryFeature[] {
  if (countriesCache) return countriesCache;
  type Topo = Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const topo = land as unknown as Topo;
  const fc = feature(topo, topo.objects.countries);
  countriesCache = fc.features
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f) => {
      const geom = f.geometry as Polygon | MultiPolygon;
      const name = f.properties?.name ?? "";
      const id = f.id === undefined ? "" : String(f.id).padStart(3, "0");
      const iso2 = NUM_TO_ISO2[id] ?? NAME_TO_ISO2[name] ?? "";
      return { type: "Feature", geometry: geom, properties: { name, iso2, ...centreOf(geom) } } as CountryFeature;
    });
  return countriesCache;
}

/* ---------- colours */
interface Palette {
  lanes: Record<LaneId, string>;
  accent: string;
  text: string;
  muted: string;
  border: string;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const lanes = {} as Record<LaneId, string>;
  for (const l of LANES) lanes[l.id] = v(`--lane-${l.id}`, "#888888");
  return {
    lanes,
    accent: v("--accent", "#f5b53f"),
    text: v("--text", "#d8dfe8"),
    muted: v("--muted", "#7c8896"),
    border: v("--border", "#1f2833"),
  };
}

/** #rgb, #rrggbb or rgb()/rgba() to rgba() with the given alpha; anything else is returned as-is. */
function withAlpha(color: string, a: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    const h = c.length === 4 ? c.slice(1).split("").map((x) => x + x).join("") : c.slice(1, 7);
    const n = parseInt(h, 16);
    if (Number.isFinite(n)) return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(/[\s,\/]+/);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}

function dominantLane(p: GeoPoint): LaneId {
  let best: LaneId = "markets";
  let n = -1;
  for (const l of LANES) {
    const c = p.lanes[l.id] ?? 0;
    if (c > n) { n = c; best = l.id; }
  }
  return best;
}

function topLanes(p: GeoPoint, k: number): { id: LaneId; n: number }[] {
  return LANES.map((l) => ({ id: l.id, n: p.lanes[l.id] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, k);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

const GLOBE_COLOR = { dark: "#0e1620", light: "#e6edf5" } as const;
const ATMOSPHERE_COLOR = { dark: "#6b7f99", light: "#8fa3ba" } as const;
const MAX_ARCS = 120;
const MAX_LABELS = 8;
/** Two labels closer than this (great-circle degrees) would overprint; the lower count is dropped. */
const LABEL_MIN_SEPARATION_DEG = 6;
/** Labels only show once the camera is closer than this altitude (the overview sits at exactly 2.2). */
const LABEL_MAX_ALTITUDE = 2.2;
const OVERVIEW_ALTITUDE = 2.2;
const HEADLINES = 12;
/** Alpha for points and arcs that do not touch the selected country. */
const DIM_ALPHA = 0.25;

const toRad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in degrees (haversine). */
function angularDistance(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h))) * 180) / Math.PI;
}

/** Greedy by count: a label is kept only when every label already kept is at least LABEL_MIN_SEPARATION_DEG away. */
export function pickLabels<T extends { lat: number; lng: number; count: number }>(points: T[], max = MAX_LABELS, minSep = LABEL_MIN_SEPARATION_DEG): T[] {
  const sorted = [...points].sort((a, b) => b.count - a.count);
  const out: T[] = [];
  for (const p of sorted) {
    if (out.length >= max) break;
    if (out.every((q) => angularDistance(p.lat, p.lng, q.lat, q.lng) >= minSep)) out.push(p);
  }
  return out;
}

const labelsVisibleAt = (altitude: number) => altitude < LABEL_MAX_ALTITUDE - 0.01;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

type Status = "loading" | "ready" | "nowebgl";

export default function GlobeView({ points, flows, items, theme, onSelectCountry, selected = null }: GlobeViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  /* globe.gl's chained instance type fights every accessor signature; the surface used here is small and stable */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null);
  const paletteRef = useRef<Palette | null>(null);
  const selectedRef = useRef<string | null>(selected);
  const interactedRef = useRef(false);
  const onSelectRef = useRef(onSelectCountry);
  const pointsRef = useRef(points);
  const labelDataRef = useRef<{ iso2: string; text: string; lat: number; lng: number; count: number }[]>([]);
  /** Whether the camera is close enough for labels; flipped by globe.gl's onZoom. */
  const labelsOnRef = useRef(false);
  const [status, setStatus] = useState<Status>("loading");
  const [legendOpen, setLegendOpen] = useState(false);
  const { match: compact } = useMediaQuery("(max-width: 640px)");
  const now = useNow(60_000);

  onSelectRef.current = onSelectCountry;
  pointsRef.current = points;

  /* ---------- derived data (memoised so the globe only re-digests when the inputs change) */
  const maxCount = useMemo(() => points.reduce((m, p) => Math.max(m, p.count), 0), [points]);
  const byIso = useMemo(() => new Map(points.map((p) => [p.iso2, p])), [points]);

  const pointData = useMemo(() => {
    const denom = Math.sqrt(Math.max(1, maxCount));
    return points.map((p) => ({
      iso2: p.iso2,
      label: p.label,
      lat: p.lat,
      lng: p.lng,
      count: p.count,
      lane: dominantLane(p),
      top: topLanes(p, 3),
      radius: 0.25 + 1.35 * (Math.sqrt(p.count) / denom),
    }));
  }, [points, maxCount]);

  const arcData = useMemo(() => {
    const sorted = [...flows].sort((a, b) => b.count - a.count).slice(0, MAX_ARCS);
    const max = Math.sqrt(Math.max(1, sorted[0]?.count ?? 1));
    return sorted.map((f) => ({
      from: f.from,
      to: f.to,
      startLat: f.fromLat,
      startLng: f.fromLng,
      endLat: f.toLat,
      endLng: f.toLng,
      count: f.count,
      lane: f.lane,
      stroke: 0.3 + 0.9 * (Math.sqrt(f.count) / max),
    }));
  }, [flows]);

  const labelData = useMemo(
    () => pickLabels(points).map((p) => ({ iso2: p.iso2, text: p.label, lat: p.lat, lng: p.lng, count: p.count })),
    [points],
  );
  labelDataRef.current = labelData;

  const laneCounts = useMemo(() => {
    const out = {} as Record<LaneId, number>;
    for (const l of LANES) out[l.id] = 0;
    for (const p of points) for (const l of LANES) out[l.id] += p.lanes[l.id] ?? 0;
    return out;
  }, [points]);

  /* ---------- styling helpers, applied at mount, on theme change and when data changes */
  const applyStyle = (g: NonNullable<typeof globeRef.current>, pal: Palette, th: "dark" | "light", max: number) => {
    const mat = g.globeMaterial() as MeshPhongMaterial;
    mat.color.set(GLOBE_COLOR[th]);
    mat.map = null;
    mat.needsUpdate = true;
    g.atmosphereColor(ATMOSPHERE_COLOR[th]);
    const denom = Math.sqrt(Math.max(1, max));
    const empty = th === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)";
    g.polygonCapColor((d: CountryFeature) => {
      const p = pointsRef.current.find((x) => x.iso2 === d.properties.iso2);
      if (!p || !d.properties.iso2) return empty;
      const t = Math.sqrt(p.count) / denom;
      return withAlpha(pal.accent, 0.12 + 0.55 * t);
    });
    g.polygonStrokeColor((d: CountryFeature) =>
      d.properties.iso2 && d.properties.iso2 === selectedRef.current ? pal.accent : "rgba(255,255,255,0.12)");
    /* with a country selected, everything that does not touch it fades to DIM_ALPHA */
    g.pointColor((d: { lane: LaneId; iso2: string }) => {
      const sel = selectedRef.current;
      return sel && d.iso2 !== sel ? withAlpha(pal.lanes[d.lane], DIM_ALPHA) : pal.lanes[d.lane];
    });
    g.arcColor((d: { lane: LaneId; from: string; to: string }) => {
      const sel = selectedRef.current;
      const c = pal.lanes[d.lane];
      if (sel && d.from !== sel && d.to !== sel) return [withAlpha(c, DIM_ALPHA * 0.3), withAlpha(c, DIM_ALPHA)];
      return [withAlpha(c, 0.25), withAlpha(c, 0.85)];
    });
    g.labelColor(() => withAlpha(pal.text, 0.85));
  };

  /** Pushes the label set, or nothing while the camera is too far out. */
  const syncLabels = (g: NonNullable<typeof globeRef.current>) => {
    g.labelsData(labelsOnRef.current ? labelDataRef.current : []);
  };

  /* ---------- create the globe once */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!hasWebGL()) { setStatus("nowebgl"); return; }
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let g: any = null;

    import("globe.gl").then(({ default: Globe }) => {
      if (cancelled || !hostRef.current) return;
      try {
        g = new Globe(hostRef.current, { animateIn: false, rendererConfig: { antialias: true, alpha: true } });
      } catch {
        setStatus("nowebgl");
        return;
      }
      globeRef.current = g;
      const pal = readPalette();
      paletteRef.current = pal;

      g.backgroundColor("rgba(0,0,0,0)")
        .showAtmosphere(true)
        .atmosphereAltitude(0.12)
        .polygonsData(countries())
        .polygonAltitude(0.006)
        .polygonSideColor(() => "rgba(0,0,0,0)")
        .polygonsTransitionDuration(0)
        .polygonLabel((d: CountryFeature) => {
          const p = pointsRef.current.find((x) => x.iso2 === d.properties.iso2);
          return `<div class="globe-tip"><b>${esc(d.properties.name)}</b>${p ? ` ${p.count} mention${p.count === 1 ? "" : "s"}` : ""}</div>`;
        })
        .pointAltitude(0.01)
        .pointRadius("radius")
        .pointsMerge(false)
        .pointsTransitionDuration(300)
        .pointLabel((d: { label: string; count: number; top: { id: LaneId; n: number }[] }) =>
          `<div class="globe-tip"><b>${esc(d.label)}</b> ${d.count} mention${d.count === 1 ? "" : "s"}<br/>${d.top.map((t) => `${LANE_BY_ID[t.id].short} ${t.n}`).join(" / ")}</div>`)
        .arcStroke("stroke")
        .arcAltitude(null)
        .arcAltitudeAutoScale(0.35)
        .arcDashLength(0.4)
        .arcDashGap(0.2)
        .arcDashAnimateTime(4000)
        .arcsTransitionDuration(0)
        .arcLabel((d: { from: string; to: string; count: number; lane: LaneId }) =>
          `<div class="globe-tip">${esc(d.from)} to ${esc(d.to)}: ${d.count} (${LANE_BY_ID[d.lane].short})</div>`)
        .labelText("text")
        .labelSize(0.55)
        .labelDotRadius(0)
        .labelAltitude(0.015)
        .labelResolution(2)
        .labelsTransitionDuration(0)
        .onPolygonClick((d: CountryFeature) => {
          const iso2 = d.properties.iso2;
          onSelectRef.current?.(iso2 || null);
        })
        .onPointClick((d: { iso2: string }) => onSelectRef.current?.(d.iso2 || null))
        .onLabelClick((d: { iso2: string }) => onSelectRef.current?.(d.iso2 || null))
        .onGlobeClick(() => onSelectRef.current?.(null))
        .onZoom((pov: { altitude: number }) => {
          const on = labelsVisibleAt(pov.altitude);
          if (on === labelsOnRef.current) return;
          labelsOnRef.current = on;
          syncLabels(g);
        });

      applyStyle(g, pal, theme, maxCount);
      g.pointsData(pointData).arcsData(arcData);
      labelsOnRef.current = labelsVisibleAt(OVERVIEW_ALTITUDE);
      syncLabels(g);

      const controls = g.controls();
      controls.autoRotate = !selectedRef.current;
      controls.autoRotateSpeed = 0.35;
      controls.enablePan = false;
      controls.minDistance = 130;
      controls.maxDistance = 600;
      controls.addEventListener("start", () => {
        interactedRef.current = true;
        controls.autoRotate = false;
      });

      const size = () => {
        const r = host.getBoundingClientRect();
        g.width(Math.max(1, Math.floor(r.width))).height(Math.max(1, Math.floor(r.height)));
      };
      size();
      g.pointOfView({ lat: 25, lng: 10, altitude: OVERVIEW_ALTITUDE }, 0);
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(size);
        ro.observe(host);
      }
      setStatus("ready");
    }).catch(() => {
      if (!cancelled) setStatus("nowebgl");
    });

    return () => {
      cancelled = true;
      ro?.disconnect();
      const inst = globeRef.current;
      globeRef.current = null;
      try {
        inst?._destructor?.();
      } catch {
        /* the renderer may already be gone */
      }
      host.replaceChildren();
    };
    /* the globe is created once; later prop changes go through the effects below */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- theme: re-read CSS variables after the html attribute flipped */
  useEffect(() => {
    const g = globeRef.current;
    if (!g || status !== "ready") return;
    const pal = readPalette();
    paletteRef.current = pal;
    applyStyle(g, pal, theme, maxCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, status]);

  /* ---------- data */
  useEffect(() => {
    const g = globeRef.current;
    if (!g || status !== "ready") return;
    const pal = paletteRef.current ?? readPalette();
    /* fresh accessors so the cap colour rescales with the new maximum */
    applyStyle(g, pal, theme, maxCount);
    g.pointsData(pointData).arcsData(arcData);
    syncLabels(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointData, arcData, labelData, maxCount, status]);

  /* ---------- selection: accent stroke, stop rotating, fly to it */
  useEffect(() => {
    selectedRef.current = selected;
    const g = globeRef.current;
    if (!g || status !== "ready") return;
    const pal = paletteRef.current ?? readPalette();
    /* fresh accessors: the stroke follows the selection and the points and arcs dim around it */
    applyStyle(g, pal, theme, maxCount);
    const controls = g.controls();
    controls.autoRotate = !selected && !interactedRef.current;
    if (!selected) return;
    const p = byIso.get(selected);
    const target = p ?? countries().find((c) => c.properties.iso2 === selected)?.properties;
    if (target) g.pointOfView({ lat: target.lat, lng: target.lng, altitude: 1.6 }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, status, byIso]);

  /* ---------- overlay list for the selected country */
  const selectedPoint = selected ? byIso.get(selected) : undefined;
  const selectedName = selected
    ? selectedPoint?.label ?? countries().find((c) => c.properties.iso2 === selected)?.properties.name ?? selected
    : "";
  const headlines = useMemo(() => {
    if (!selectedPoint) return [];
    const out: { id: string; title: string; source: string; lane: LaneId; ts: number; link: string }[] = [];
    for (const id of selectedPoint.itemIds) {
      const it = items.get(id);
      if (it) out.push(it);
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, HEADLINES);
  }, [selectedPoint, items]);

  return (
    <div className={css.wrap}>
      <div ref={hostRef} className={css.canvas} />
      {status === "loading" && <div className={css.placeholder}>loading globe</div>}
      {status === "nowebgl" && <div className={css.placeholder}>WebGL not available</div>}

      {compact && !legendOpen ? (
        <button type="button" className={`${css.legend} ${css.legendMini}`} onClick={() => setLegendOpen(true)} aria-expanded={false} aria-label="show legend">
          mentions {"\u00b7"} flows <span className="cnt">{flows.length}</span>
        </button>
      ) : (
        <div className={css.legend} aria-hidden={!compact}>
          <div className={css.legendTitle}>
            mentions in window
            {compact && (
              <button type="button" className={css.legendClose} onClick={() => setLegendOpen(false)} aria-label="hide legend">
                x
              </button>
            )}
          </div>
          <div className={css.lanes}>
            {LANES.map((l) => (
              <span key={l.id} className={`${css.lane} lc-${l.id}`}>
                <i className={css.dot} />
                {l.short} <span className="cnt">{laneCounts[l.id]}</span>
              </span>
            ))}
          </div>
          <div>flows: <span className="cnt">{flows.length}</span>{flows.length > MAX_ARCS ? ` (${MAX_ARCS} drawn)` : ""}</div>
          <div className={css.hint}>{compact ? "tap a country to filter" : "click a country to filter"}</div>
        </div>
      )}

      {selected && (
        <aside className={css.sheet} aria-label={`headlines for ${selectedName}`}>
          <div className={css.sheetHead}>
            <span className={css.sheetTitle}>{selectedName}</span>
            <span className="cnt">{selectedPoint?.count ?? 0} mention{(selectedPoint?.count ?? 0) === 1 ? "" : "s"}</span>
            <button type="button" className={css.close} aria-label="clear country filter" onClick={() => onSelectCountry?.(null)}>
              x
            </button>
          </div>
          <div className={css.list}>
            {headlines.length === 0 && <div className={css.empty}>no headlines for this country in the window</div>}
            {headlines.map((h) => (
              <a key={h.id} className={`${css.row} lc-${h.lane}`} href={h.link} target="_blank" rel="noopener noreferrer">
                <i className={css.dot} />
                <span className={css.rowBody}>
                  <span className={css.rowTitle}>{h.title}</span>
                  <span className={css.rowMeta}>
                    <span>{h.source}</span>
                    <span className="mono">{relativeTime(h.ts, now || Date.now())}</span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
