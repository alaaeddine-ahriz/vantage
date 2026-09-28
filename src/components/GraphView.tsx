"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject } from "react";
import type { ForceGraphProps } from "react-force-graph-2d";
import type { LaneId } from "@/lib/types";
import { LANES } from "@/lib/types";
import type { EntityKind, GraphLink, GraphNode, LinkKind } from "@/lib/intel-types";
import { ArrowRight, ChevronDown, ChevronUp, Crosshair, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fold, relativeTime, useNow } from "./util";

/* ---------- shared utility class strings */
const PLACEHOLDER = "absolute inset-0 flex items-center justify-center text-xs tracking-[0.04em] text-muted-foreground";
const DOT = "inline-block size-[7px] shrink-0 rounded-full";
const SW = "size-[9px] shrink-0 rounded-full";
const SW_LINE = "w-3.5 shrink-0 border-t-[1.5px]";
const LEGEND_HEAD = "col-span-2 mt-0.5 text-[10px] tracking-[0.08em] uppercase";
const LEGEND_ROW = "flex items-center gap-[5px] whitespace-nowrap";
const LBL = "text-[11px] tracking-[0.08em] text-muted-foreground uppercase";

/* ------------------------------------------------------------------ types */

export interface GraphViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  items: Map<string, { id: string; title: string; source: string; lane: LaneId; ts: number; link: string }>;
  theme: "dark" | "light";
  focus?: string | null;
  onFocus?: (nodeId: string | null) => void;
}

/** Node object handed to the force engine; kept stable per id so positions survive refreshes. */
interface GNode {
  id: string;
  kind: EntityKind | "event";
  label: string;
  weight: number;
  lane?: LaneId;
  itemIds: string[];
  ai?: boolean;
  /** 0-based rank by weight among non-event nodes, used for progressive label reveal. */
  rank: number;
  x?: number;
  y?: number;
}

interface GLinkBase {
  kind: LinkKind;
  weight: number;
  label?: string;
  itemIds: string[];
  ai?: boolean;
}

type GLink = GLinkBase & { source?: string | number | GNode; target?: string | number | GNode };

/** The subset of the force-graph instance API this component calls. */
interface FGMethods {
  zoomToFit(durationMs?: number, padding?: number): unknown;
  zoom(): number;
  zoom(scale: number, durationMs?: number): unknown;
  centerAt(x?: number, y?: number, durationMs?: number): unknown;
  d3Force(name: string): { strength?: (v: unknown) => unknown; distance?: (v: unknown) => unknown } | undefined;
  d3ReheatSimulation(): unknown;
}

type FGProps = ForceGraphProps<GNode, GLinkBase> & { ref?: MutableRefObject<FGMethods | undefined> };

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <div className={PLACEHOLDER}>loading graph</div>,
}) as unknown as ComponentType<FGProps>;

/* -------------------------------------------------------------- constants */

const MAX_NODES = 400;
const MAX_LINKS = 900;
const CAUSAL: ReadonlySet<LinkKind> = new Set(["causes", "impacts", "triggers", "responds", "supplies"]);
const isCausal = (k: LinkKind) => CAUSAL.has(k);

const KIND_COLOR: Record<"dark" | "light", Record<EntityKind, string>> = {
  dark: { country: "#5b8def", company: "#d9a441", commodity: "#3fbf9f", org: "#9d7bff", topic: "#9d7bff" },
  light: { country: "#2d5fc4", company: "#a8791c", commodity: "#1f8f74", org: "#6a45c4", topic: "#6a45c4" },
};

const LANE_VARS: Record<LaneId, string> = {
  oilgas: "--lane-oilgas",
  power: "--lane-power",
  renewables: "--lane-renewables",
  industry: "--lane-industry",
  policy: "--lane-policy",
  markets: "--lane-markets",
};

interface Palette {
  text: string;
  muted: string;
  accent: string;
  focus: string;
  bg: string;
  panel: string;
  lanes: Record<LaneId, string>;
}

const FALLBACK: Palette = {
  text: "#d8dfe8",
  muted: "#7c8896",
  accent: "#f5b53f",
  focus: "#4fa3ff",
  bg: "#0a0d12",
  panel: "#10151c",
  lanes: {
    oilgas: "#f08c3a",
    power: "#4fa3ff",
    renewables: "#43d17a",
    industry: "#b58cff",
    policy: "#ff6b8a",
    markets: "#e0c34a",
  },
};

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const lanes = {} as Record<LaneId, string>;
  for (const l of LANES) lanes[l.id] = get(LANE_VARS[l.id], FALLBACK.lanes[l.id]);
  return {
    text: get("--text", FALLBACK.text),
    muted: get("--muted", FALLBACK.muted),
    accent: get("--accent", FALLBACK.accent),
    focus: get("--focus", FALLBACK.focus),
    bg: get("--bg", FALLBACK.bg),
    panel: get("--panel", FALLBACK.panel),
    lanes,
  };
}

/** #rgb / #rrggbb to rgba(); anything else is returned untouched. */
function rgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const radiusOf = (w: number) => Math.min(18, 3 + 2.2 * Math.sqrt(Math.max(0, w)));

const endId = (e: GLink["source"]): string => (typeof e === "object" && e !== null ? e.id : String(e ?? ""));

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const truncate = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

const KIND_LABEL: Record<EntityKind | "event", string> = {
  country: "country",
  company: "company",
  commodity: "commodity",
  org: "organisation",
  topic: "topic",
  event: "event",
};

interface Neighbour {
  id: string;
  kind: LinkKind;
  label?: string;
  ai?: boolean;
  /** "out": focus -> neighbour, "in": neighbour -> focus. */
  dir: "out" | "in";
}

/* -------------------------------------------------------------- component */

export default function GraphView({ nodes, links, items, theme, focus = null, onFocus }: GraphViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGMethods | undefined>(undefined);
  const nodePool = useRef(new Map<string, GNode>());
  const lastClick = useRef<{ id: string; t: number }>({ id: "", t: 0 });
  /** zoomToFit runs once, when the first layout settles; later refreshes keep the user's zoom. */
  const fitted = useRef(false);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [palette, setPalette] = useState<Palette>(FALLBACK);
  const [causalOnly, setCausalOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const now = useNow(60_000);
  const uid = useId();

  /* ----- size: fill the parent */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ----- theme tokens */
  useEffect(() => {
    /* a frame later so the html.dark toggle has been applied by the parent */
    const id = requestAnimationFrame(() => setPalette(readPalette()));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  /* ----- data: cap, rank, reuse node objects */
  const { graphData, total, shownNodes, shownLinks, causalCount } = useMemo(() => {
    const sortedNodes = [...nodes].sort((a, b) => b.weight - a.weight);
    const kept = sortedNodes.length > MAX_NODES ? sortedNodes.slice(0, MAX_NODES) : sortedNodes;
    const keep = new Set(kept.map((n) => n.id));
    const pool = nodePool.current;
    const next = new Map<string, GNode>();
    let rank = 0;
    const gNodes: GNode[] = kept.map((n) => {
      const prev = pool.get(n.id);
      const obj: GNode = prev ?? { id: n.id, kind: n.kind, label: n.label, weight: n.weight, itemIds: n.itemIds, rank: 0 };
      obj.kind = n.kind;
      obj.label = n.label;
      obj.weight = n.weight;
      obj.lane = n.lane;
      obj.itemIds = n.itemIds;
      obj.ai = n.ai;
      obj.rank = n.kind === "event" ? Number.MAX_SAFE_INTEGER : rank++;
      next.set(n.id, obj);
      return obj;
    });
    nodePool.current = next;
    const seen = new Set<string>();
    const validLinks = links.filter((l) => {
      if (l.source === l.target || !keep.has(l.source) || !keep.has(l.target)) return false;
      const k = `${l.source}|${l.target}|${l.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    validLinks.sort((a, b) => b.weight - a.weight);
    const keptLinks = validLinks.length > MAX_LINKS ? validLinks.slice(0, MAX_LINKS) : validLinks;
    const gLinks: GLink[] = keptLinks.map((l) => ({
      source: l.source,
      target: l.target,
      kind: l.kind,
      weight: l.weight,
      label: l.label,
      itemIds: l.itemIds,
      ai: l.ai,
    }));
    return {
      graphData: { nodes: gNodes, links: gLinks },
      total: { nodes: nodes.length, links: validLinks.length },
      shownNodes: gNodes.length,
      shownLinks: gLinks.length,
      causalCount: gLinks.filter((l) => isCausal(l.kind)).length,
    };
  }, [nodes, links]);

  const nodeById = useMemo(() => new Map(graphData.nodes.map((n) => [n.id, n])), [graphData]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Neighbour[]>();
    const push = (id: string, nb: Neighbour) => {
      const arr = m.get(id);
      if (arr) arr.push(nb);
      else m.set(id, [nb]);
    };
    for (const l of graphData.links) {
      const a = endId(l.source);
      const b = endId(l.target);
      push(a, { id: b, kind: l.kind, label: l.label, ai: l.ai, dir: "out" });
      push(b, { id: a, kind: l.kind, label: l.label, ai: l.ai, dir: "in" });
    }
    return m;
  }, [graphData]);

  const focusNode = focus ? nodeById.get(focus) ?? null : null;
  const neighbourIds = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    set.add(focus);
    for (const nb of adjacency.get(focus) ?? []) set.add(nb.id);
    return set;
  }, [focus, adjacency]);

  const q = fold(query.trim());
  const hits = useMemo(() => {
    const set = new Set<string>();
    if (!q) return set;
    for (const n of graphData.nodes) if (fold(n.label).includes(q)) set.add(n.id);
    return set;
  }, [q, graphData]);

  /* ----- physics: applied once the dynamic component has mounted and on every data change */
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const apply = () => {
      const fg = fgRef.current;
      if (!fg) {
        if (tries++ < 120) raf = requestAnimationFrame(apply);
        return;
      }
      fg.d3Force("charge")?.strength?.(-120);
      fg.d3Force("link")?.distance?.((l: GLink) => (isCausal(l.kind) ? 60 : 40));
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [graphData]);

  /* ----- helpers reading the latest state (canvas callbacks are recreated when these change) */
  const kindColor = useCallback(
    (n: GNode): string => {
      if (n.kind === "event") return n.lane ? palette.lanes[n.lane] : palette.muted;
      return KIND_COLOR[theme][n.kind];
    },
    [palette, theme],
  );

  const nodeAlpha = useCallback(
    (id: string): number => {
      if (focus) return neighbourIds.has(id) ? 1 : 0.15;
      if (q) return hits.has(id) ? 1 : 0.35;
      return 1;
    },
    [focus, neighbourIds, q, hits],
  );

  const linkAlphaFactor = useCallback(
    (l: GLink): number => {
      if (!focus) return 1;
      const a = endId(l.source);
      const b = endId(l.target);
      return a === focus || b === focus ? 1 : 0.15;
    },
    [focus],
  );

  const linkBaseColor = useCallback(
    (l: GLink): string => {
      if (!isCausal(l.kind)) return palette.muted;
      return l.ai ? palette.accent : palette.text;
    },
    [palette],
  );

  const linkColor = useCallback(
    (l: GLink): string => {
      const base = isCausal(l.kind) ? 0.7 : 0.25;
      return rgba(linkBaseColor(l), base * linkAlphaFactor(l));
    },
    [linkBaseColor, linkAlphaFactor],
  );

  const linkWidth = useCallback((l: GLink): number => {
    return isCausal(l.kind) ? Math.min(4, 1 + l.weight * 0.4) : Math.min(3, 0.5 + l.weight * 0.3);
  }, []);

  const linkVisible = useCallback((l: GLink): boolean => !causalOnly || isCausal(l.kind), [causalOnly]);

  /* ----- canvas: nodes */
  const drawNode = useCallback(
    (n: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const r = radiusOf(n.weight);
      const color = kindColor(n);
      const alpha = nodeAlpha(n.id);
      const isFocus = n.id === focus;
      const isHover = n.id === hoverId;
      const isHit = hits.has(n.id);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      if (n.kind === "event") {
        const w = r * 2.2;
        const h = r * 1.3;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(3, h / 3));
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (n.ai) {
        ctx.setLineDash([2 / scale, 2 / scale]);
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = palette.accent;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5 / scale, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isFocus || isHit || isHover) {
        ctx.lineWidth = (isFocus ? 2 : 1.5) / scale;
        ctx.strokeStyle = isFocus ? palette.accent : palette.focus;
        ctx.beginPath();
        ctx.arc(x, y, r + (isFocus ? 4 : 3) / scale, 0, 2 * Math.PI);
        ctx.stroke();
      }
      /* labels: forced for focus, hover, neighbours of focus and search hits; otherwise progressive by rank */
      let show = isFocus || isHover || isHit || (focus !== null && neighbourIds.has(n.id));
      if (!show) {
        if (n.kind === "event") show = scale >= 2.2;
        else show = n.rank < 25 * Math.max(1, scale) * Math.max(1, scale) || n.weight * scale >= 6;
      }
      if (show) {
        const px = Math.max(3, 12 / scale);
        ctx.font = `${isFocus ? "600 " : ""}${px}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const text = n.kind === "event" ? truncate(n.label, 48) : n.label;
        const ty = y + r + 2 / scale;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = rgba(palette.bg, 0.8);
        ctx.lineJoin = "round";
        ctx.strokeText(text, x, ty);
        ctx.fillStyle = palette.text;
        ctx.fillText(text, x, ty);
      }
      ctx.restore();
    },
    [kindColor, nodeAlpha, focus, hoverId, hits, neighbourIds, palette],
  );

  const paintPointer = useCallback((n: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const r = radiusOf(n.weight) + 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (n.kind === "event") ctx.rect(x - r * 1.1, y - r * 0.65, r * 2.2, r * 1.3);
    else ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  /* ----- canvas: link labels, drawn after the default line */
  const drawLinkAfter = useCallback(
    (l: GLink, ctx: CanvasRenderingContext2D, scale: number) => {
      if (scale < 1.8 || !l.label || !isCausal(l.kind) || !linkVisible(l)) return;
      const a = l.source;
      const b = l.target;
      if (typeof a !== "object" || typeof b !== "object" || !a || !b) return;
      const mx = ((a.x ?? 0) + (b.x ?? 0)) / 2;
      const my = ((a.y ?? 0) + (b.y ?? 0)) / 2;
      const px = Math.max(3, 10 / scale);
      ctx.save();
      ctx.globalAlpha = linkAlphaFactor(l);
      ctx.font = `${px}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const text = truncate(l.label, 40);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = rgba(palette.panel, 0.85);
      ctx.beginPath();
      ctx.roundRect(mx - w / 2 - 3 / scale, my - px * 0.7, w + 6 / scale, px * 1.4, 2 / scale);
      ctx.fill();
      ctx.fillStyle = l.ai ? palette.accent : palette.text;
      ctx.fillText(text, mx, my);
      ctx.restore();
    },
    [linkVisible, linkAlphaFactor, palette],
  );

  /* ----- tooltip */
  const tooltip = useCallback(
    (n: GNode): string => {
      const heads = n.itemIds
        .map((id) => items.get(id))
        .filter((it): it is NonNullable<typeof it> => !!it)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 3);
      const lines = heads.map((h) => `<div style="opacity:.8;margin-top:2px">${esc(truncate(h.title, 90))}</div>`).join("");
      return (
        `<div style="max-width:320px;font-size:12px;line-height:1.35">` +
        `<b>${esc(n.label)}</b> <span style="opacity:.7">${KIND_LABEL[n.kind]}${n.lane ? ` / ${n.lane}` : ""} / weight ${n.weight}${n.ai ? " / ai" : ""}</span>` +
        lines +
        `</div>`
      );
    },
    [items],
  );

  /* ----- interaction */
  const zoomTo = useCallback((n: GNode, ms = 600) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.centerAt(n.x ?? 0, n.y ?? 0, ms);
    fg.zoom(4, ms);
  }, []);

  const onNodeClick = useCallback(
    (n: GNode) => {
      const t = Date.now();
      const last = lastClick.current;
      lastClick.current = { id: n.id, t };
      if (last.id === n.id && t - last.t < 380) {
        zoomTo(n);
        return;
      }
      onFocus?.(n.id);
    },
    [onFocus, zoomTo],
  );

  const onBackgroundClick = useCallback(() => onFocus?.(null), [onFocus]);
  const onNodeHover = useCallback((n: GNode | null) => setHoverId(n ? n.id : null), []);

  const fit = useCallback(() => fgRef.current?.zoomToFit(600, 40), []);
  const onEngineStop = useCallback(() => {
    if (fitted.current) return;
    fitted.current = true;
    fgRef.current?.zoomToFit(400, 40);
  }, []);
  const zoomBy = useCallback((f: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(Math.max(0.05, Math.min(12, fg.zoom() * f)), 300);
  }, []);

  const onSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setQuery("");
        return;
      }
      if (e.key !== "Enter" || !q) return;
      const first = graphData.nodes.find((n) => hits.has(n.id));
      if (!first) return;
      onFocus?.(first.id);
      const fg = fgRef.current;
      if (fg) {
        fg.centerAt(first.x ?? 0, first.y ?? 0, 600);
        if (fg.zoom() < 2.5) fg.zoom(2.5, 600);
      }
    },
    [q, hits, graphData, onFocus],
  );

  /* ----- detail data */
  const neighbours = useMemo(() => {
    if (!focus) return [];
    const list = (adjacency.get(focus) ?? []).filter((nb) => !causalOnly || isCausal(nb.kind));
    return list
      .map((nb) => ({ nb, node: nodeById.get(nb.id) }))
      .filter((x): x is { nb: Neighbour; node: GNode } => !!x.node)
      .sort((a, b) => Number(isCausal(b.nb.kind)) - Number(isCausal(a.nb.kind)) || b.node.weight - a.node.weight);
  }, [focus, adjacency, nodeById, causalOnly]);

  const headlines = useMemo(() => {
    if (!focusNode) return [];
    return focusNode.itemIds
      .map((id) => items.get(id))
      .filter((it): it is NonNullable<typeof it> => !!it)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20);
  }, [focusNode, items]);

  const capped = total.nodes > shownNodes || total.links > shownLinks;
  const focusColor = focusNode ? kindColor(focusNode) : palette.muted;

  return (
    <div ref={wrapRef} className="relative size-full min-h-[420px] overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        {size.w > 0 && size.h > 0 && graphData.nodes.length > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeId="id"
            nodeVal={(n) => Math.max(1, n.weight)}
            nodeLabel={tooltip}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={paintPointer}
            linkVisibility={linkVisible}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkDirectionalArrowLength={(l) => (isCausal(l.kind) ? 4 : 0)}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={linkColor}
            linkDirectionalParticles={(l) => (isCausal(l.kind) ? 2 : 0)}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleColor={linkColor}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={drawLinkAfter}
            linkLineDash={(l) => (l.ai ? [3, 2] : null)}
            warmupTicks={40}
            cooldownTicks={120}
            d3VelocityDecay={0.3}
            minZoom={0.05}
            maxZoom={12}
            onNodeClick={onNodeClick}
            onNodeHover={onNodeHover}
            onBackgroundClick={onBackgroundClick}
            onEngineStop={onEngineStop}
          />
        )}
        {graphData.nodes.length === 0 && <div className={PLACEHOLDER}>no entities in this window yet</div>}
      </div>

      <Card className="absolute top-2 left-2 z-[2] w-[232px] max-w-[calc(100%-1rem)] gap-1.5 rounded-md bg-card/85 p-2 text-xs shadow-none backdrop-blur max-[859px]:w-[200px]">
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={fit} title="Fit graph to view">
            <Maximize2 className="size-3.5" /> Fit
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-7" onClick={() => zoomBy(1.5)} aria-label="Zoom in">
            <Plus className="size-3.5" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-7" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">
            <Minus className="size-3.5" />
          </Button>
          <Label htmlFor={`${uid}-causal`} className="ml-1 cursor-pointer gap-1.5 text-[11px] font-normal text-muted-foreground">
            <Switch id={`${uid}-causal`} className="h-3.5 w-6 [&_[data-slot=switch-thumb]]:size-3" checked={causalOnly} onCheckedChange={setCausalOnly} />
            causal only
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-6 text-muted-foreground hover:text-foreground max-[859px]:hidden"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            title={legendOpen ? "Hide legend" : "Show legend"}
          >
            {legendOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="text"
            className="h-7 pl-6 text-xs md:text-xs"
            value={query}
            placeholder="find node, Enter to focus"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label="Search nodes"
          />
        </div>
        <div className="truncate font-mono text-[11px] tabular-nums whitespace-nowrap text-muted-foreground">
          {shownNodes} nodes {"·"} {shownLinks} links {"·"} {causalCount} causal
          {q ? ` · ${hits.size} match${hits.size === 1 ? "" : "es"}` : ""}
        </div>
        {capped && (
          <div className="text-[11px] text-primary">
            showing top {shownNodes} of {total.nodes} nodes, {shownLinks} of {total.links} links
          </div>
        )}
        {legendOpen && (
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground max-[859px]:hidden">
            <span className={LEGEND_HEAD}>nodes</span>
            <span className={LEGEND_ROW}><i className={SW} style={{ background: KIND_COLOR[theme].country }} />country</span>
            <span className={LEGEND_ROW}><i className={SW} style={{ background: KIND_COLOR[theme].company }} />company</span>
            <span className={LEGEND_ROW}><i className={SW} style={{ background: KIND_COLOR[theme].commodity }} />commodity</span>
            <span className={LEGEND_ROW}><i className={SW} style={{ background: KIND_COLOR[theme].org }} />org / topic</span>
            <span className={LEGEND_ROW}><i className={cn(SW, "rounded-sm bg-[linear-gradient(90deg,var(--lane-oilgas),var(--lane-power),var(--lane-renewables))]")} />event (lane colour)</span>
            <span className={LEGEND_ROW}><i className={cn(SW, "border border-dashed")} style={{ borderColor: palette.accent }} />ai extracted</span>
            <span className={LEGEND_HEAD}>links</span>
            <span className={LEGEND_ROW}><i className={SW_LINE} style={{ borderTopColor: palette.muted }} />co-occurs</span>
            <span className={LEGEND_ROW}><i className={SW_LINE} style={{ borderTopColor: palette.text }} /><ArrowRight className="-ml-1.5 size-2.5 shrink-0" style={{ color: palette.text }} aria-hidden="true" />causes / impacts</span>
            <span className={LEGEND_ROW}><i className={cn(SW_LINE, "border-dashed")} style={{ borderTopColor: palette.accent }} /><ArrowRight className="-ml-1.5 size-2.5 shrink-0" style={{ color: palette.accent }} aria-hidden="true" />ai link</span>
            <span className={LEGEND_ROW}><i className={cn(SW_LINE, "border-transparent")} />dbl-click: zoom</span>
          </div>
        )}
      </Card>

      {focusNode && (
        <Card
          className="absolute top-2 right-2 z-[3] grid w-[340px] max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-md bg-card/90 py-0 text-xs backdrop-blur max-[859px]:inset-x-2 max-[859px]:top-auto max-[859px]:bottom-2 max-[859px]:w-auto max-[859px]:max-w-none max-[859px]:max-h-[45%]"
          role="complementary"
          aria-label="Node detail"
        >
          <CardHeader className="flex flex-row items-start gap-1.5 border-b px-2 pt-2 pb-1.5">
            <i className={cn("mt-1 size-[9px] shrink-0 rounded-full", focusNode.kind === "event" && "rounded-sm")} style={{ background: focusColor }} aria-hidden="true" />
            <div className="min-w-0 flex-1 text-[13px] leading-[1.3] font-semibold [overflow-wrap:anywhere]">
              {focusNode.label}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">{KIND_LABEL[focusNode.kind]}</Badge>
                {focusNode.lane && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal tracking-[0.06em] uppercase" style={{ color: `var(--lane-${focusNode.lane})` }}>
                    {focusNode.lane}
                  </Badge>
                )}
                <span className="font-mono tabular-nums">weight {focusNode.weight}</span>
                {focusNode.ai && <Badge variant="outline" className="h-4 border-primary px-1 text-[10px] font-normal text-primary">ai</Badge>}
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-foreground" onClick={() => zoomTo(focusNode)} title="Zoom to node" aria-label="Zoom to node">
              <Crosshair className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-foreground" onClick={() => onFocus?.(null)} aria-label="Close detail">
              <X className="size-3.5" />
            </Button>
          </CardHeader>
          <ScrollArea className="min-h-0">
            <div className="flex flex-col gap-2 px-2 pt-1.5 pb-2">
              <div className="flex flex-col gap-0.5">
                <span className={LBL}>Connected {"·"} {neighbours.length}</span>
                {neighbours.length === 0 && <span className="text-muted-foreground">no links{causalOnly ? " (causal only)" : ""}</span>}
                {neighbours.map(({ nb, node }, i) => (
                  <Button
                    key={`${nb.id}-${nb.kind}-${i}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full items-baseline justify-start gap-1.5 px-1 py-0.5 text-xs leading-[1.35] font-normal whitespace-normal"
                    onClick={() => onFocus?.(nb.id)}
                    title={nb.label ?? `${nb.kind} (${nb.dir === "out" ? "outgoing" : "incoming"})`}
                  >
                    <i className={cn(DOT, "relative -top-px")} style={{ background: kindColor(node) }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-left">{node.label}</span>
                    <span className={cn("shrink-0 font-mono text-[10px] tracking-[0.06em] uppercase", nb.ai ? "text-primary" : "text-muted-foreground")}>
                      {isCausal(nb.kind) ? (nb.dir === "out" ? `${nb.kind} →` : `← ${nb.kind}`) : nb.kind}
                    </span>
                    {nb.label && <span className="min-w-0 flex-[0_1_45%] truncate text-[11px] text-muted-foreground">{nb.label}</span>}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className={LBL}>{headlines.length} headline{headlines.length === 1 ? "" : "s"}</span>
                {headlines.length === 0 && <span className="text-muted-foreground">no headlines in the current window</span>}
                {headlines.map((h) => (
                  <div key={h.id} className="flex items-baseline gap-1.5 py-0.5 leading-[1.35]">
                    <i className={cn(DOT, "relative -top-px")} style={{ background: `var(--lane-${h.lane})` }} aria-hidden="true" />
                    <a href={h.link} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 [overflow-wrap:anywhere] hover:underline">
                      {h.title}
                      <span className="block text-[11px] text-muted-foreground">{h.source}</span>
                    </a>
                    <span className="min-w-[2.2em] shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{relativeTime(h.ts, now || Date.now())}</span>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
