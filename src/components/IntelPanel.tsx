"use client";
import { BRIEF_MODELS } from "@/lib/brief";

import { memo, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import type { Brief, IntelSnapshot, Pattern } from "@/lib/intel-types";
import type { LaneId } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LANE_BY_ID, LANE_CLASS, fold, relativeTime, utcClock, type ViewItem } from "./util";

export type BriefState = "idle" | "loading" | "error";

export interface IntelPanelProps {
  snapshot: IntelSnapshot | null;
  brief: Brief | null;
  briefState: BriefState;
  briefError?: string;
  onGenerate: () => void;
  /** Selected model id and setter for the model dropdown. */
  model: string;
  onModel: (id: string) => void;
  onSearch: (q: string) => void;
  items: Map<string, ViewItem>;
  watchlist: string[];
  onAddWatch: (t: string) => void;
  /** Window label shown next to the header, e.g. "24h". */
  window?: string;
  now?: number;
}

/** Kind badge colours: a spike reads as a move down, an emerging theme as up, the rest borrow the lane and accent tokens. */
const KIND_CLASS: Record<Pattern["kind"], string> = {
  spike: "border-down/50 text-down",
  emerging: "border-up/50 text-up",
  cluster: "border-lane-power/50 text-lane-power",
  "co-movement": "border-primary/50 text-primary",
  ai: "border-lane-industry/50 text-lane-industry",
};

const LBL = "text-[11px] tracking-[0.08em] text-muted-foreground uppercase";
const NOTE = "text-[11px] text-muted-foreground";
const CNT = "font-mono text-[11px] text-muted-foreground tabular-nums";
const KIND_BADGE = "h-4 rounded-sm px-1 text-[10px] font-normal tracking-[0.06em] uppercase";
/* the viewport's inner div is display:table by default, which breaks width in a flex column */
const SCROLL = "min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!";

const laneDot = (lane: string) => cn("relative -top-px inline-block size-[7px] shrink-0 rounded-full", LANE_CLASS[lane as LaneId]?.bg ?? "bg-muted-foreground");

// ------------------------------------------------------------------ tiny markdown

/** Inline pass: only **bold** is recognised; everything else is plain text nodes. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<b key={`${key}-${n++}`} className="font-semibold">{m[1]}</b>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block pass: bullet runs become lists, other lines become paragraphs. No HTML is ever parsed. */
export function renderMarkdown(md: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let k = 0;
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${k++}`} className="flex list-disc flex-col gap-1 pl-3.5 marker:text-muted-foreground">
        {bullets.map((b, i) => <li key={i}>{inline(b, `b${k}-${i}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const bm = /^[-*•]\s+(.*)$/.exec(line);
    if (bm) { bullets.push(bm[1]); continue; }
    flush();
    blocks.push(<p key={`p-${k++}`}>{inline(line.replace(/^#+\s*/, ""), `p${k}`)}</p>);
  }
  flush();
  return blocks;
}

// ------------------------------------------------------------------ pieces

function HeadlineList({ rows, className }: { rows: ViewItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {rows.map((it) => (
        <li key={it.id} className="grid grid-cols-[7px_minmax(0,1fr)] items-baseline gap-1.5 text-xs leading-[1.35]">
          <span className={laneDot(it.lane)} aria-hidden="true" />
          <span>
            <a href={it.link} target="_blank" rel="noopener noreferrer" className="hover:underline">{it.title}</a>{" "}
            <span className="text-[11px] text-muted-foreground">{it.source}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Cites({ ids, items, max = 6 }: { ids: string[]; items: Map<string, ViewItem>; max?: number }) {
  const rows = ids.map((id) => items.get(id)).filter((x): x is ViewItem => !!x).slice(0, max);
  if (!rows.length) return null;
  return <HeadlineList rows={rows} className="mt-1" />;
}

function ScoreBar({ pct }: { pct: number }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-border" aria-hidden="true">
      <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PatternCard({ p, snapshot, items, onSearch }: { p: Pattern; snapshot: IntelSnapshot; items: Map<string, ViewItem>; onSearch: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  const ents = p.entityIds.map((id) => snapshot.entities[id]).filter(Boolean).slice(0, 6);
  const related = p.itemIds.map((id) => items.get(id)).filter((x): x is ViewItem => !!x).slice(0, 3);
  const pct = Math.round(Math.min(1, Math.max(0, p.score)) * 100);
  return (
    <article className="border-b px-2.5 pt-1.5 pb-2 hover:bg-accent/40">
      <div className="flex items-baseline gap-1.5">
        <Badge variant="outline" className={cn(KIND_BADGE, KIND_CLASS[p.kind])}>{p.kind}</Badge>
        <span className="min-w-0 flex-1 leading-[1.35] font-medium">{p.title}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums" title="pattern score">{pct}</span>
      </div>
      {p.detail && <div className="mt-0.5 text-xs leading-[1.4] text-muted-foreground">{p.detail}</div>}
      <ScoreBar pct={pct} />
      {ents.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ents.map((e) => (
            <Button
              key={e.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 rounded-full px-2 text-[10.5px] font-normal text-muted-foreground hover:text-foreground max-[859px]:h-8"
              title={`Search ${e.label}`}
              onClick={() => onSearch(e.label)}
            >
              {e.label}
            </Button>
          ))}
        </div>
      )}
      {related.length > 0 && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-5 px-1 text-[11px] font-normal text-muted-foreground hover:text-foreground max-[859px]:h-8"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "hide" : "show"} {related.length} headline{related.length > 1 ? "s" : ""}
          </Button>
          {open && <HeadlineList rows={related} className="mt-1 gap-1" />}
        </>
      )}
    </article>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3 p-2.5" aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-1 w-full" />
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={cn(LBL, "mb-1.5")}>{children}</div>;
}

function IntelPanelBase(p: IntelPanelProps) {
  const now = p.now ?? Date.now();
  const have = useMemo(() => new Set(p.watchlist.map(fold)), [p.watchlist]);
  const loading = p.briefState === "loading";
  const b = p.brief;
  const briefTs = b ? Date.parse(b.generatedAt) || 0 : 0;
  const modelNote = BRIEF_MODELS.find((m) => m.id === p.model)?.note;

  const generate = (
    <Button
      type="button"
      variant="default"
      size="sm"
      className="h-7 text-xs max-[859px]:h-8"
      onClick={p.onGenerate}
      disabled={loading || !p.snapshot}
      title="Send the current headlines to the model for an analyst brief"
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
      {loading ? "generating" : "Generate AI brief"}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background max-[859px]:overflow-visible" aria-label="Intelligence">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-card px-3 py-1.5">
        <span className={LBL}>Intelligence</span>
        {p.window && (
          <span className={NOTE}>
            window {p.window}{p.snapshot ? ` · ${p.snapshot.patterns.length} local patterns · ${p.snapshot.points.length} countries` : ""}
          </span>
        )}
        <span className="flex-1" />
        {briefTs > 0 && (
          <span className={cn(NOTE, "font-mono tabular-nums")} title={new Date(briefTs).toLocaleString()}>
            brief {utcClock(briefTs, false)} UTC ({relativeTime(briefTs, now)})
          </span>
        )}
        {b?.mock && <span className={NOTE}>sample brief: set ANTHROPIC_API_KEY on Vercel for live analysis</span>}
        {p.briefState === "error" && p.briefError && <span className="text-[11.5px] text-destructive" role="alert">{p.briefError}</span>}
        <span className={cn(NOTE, "inline-flex items-center gap-1.5")}>
          model
          <Select value={p.model} onValueChange={p.onModel} disabled={loading}>
            <SelectTrigger size="sm" className="h-7 gap-1 px-2 text-xs" aria-label="Model for the AI brief" title={modelNote}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BRIEF_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
        {generate}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-2">
        <Card className="min-h-0 gap-0 rounded-md py-0 shadow-none" aria-label="Local patterns">
          <CardHeader className="flex flex-row items-center gap-2 border-b px-2.5 py-1.5">
            <CardTitle className={cn(LBL, "text-foreground")}>Patterns (local)</CardTitle>
            <span className={CNT}>{p.snapshot?.patterns.length ?? 0}</span>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <ScrollArea className={SCROLL}>
              {!p.snapshot ? (
                <ListSkeleton rows={4} />
              ) : !p.snapshot.patterns.length ? (
                <div className="px-4 py-7 text-center text-xs leading-[1.5] text-muted-foreground">no patterns in this window: widen the window or clear filters</div>
              ) : (
                <div className="pb-5">
                  {p.snapshot.patterns.map((pt) => <PatternCard key={pt.id} p={pt} snapshot={p.snapshot!} items={p.items} onSearch={p.onSearch} />)}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-h-0 gap-0 rounded-md py-0 shadow-none max-lg:order-first" aria-label="AI brief">
          <CardHeader className="flex flex-row items-center gap-2 border-b px-2.5 py-1.5">
            <CardTitle className={cn(LBL, "text-foreground")}>AI brief</CardTitle>
            {b && <span className={CNT}>{b.model}</span>}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <ScrollArea className={SCROLL}>
              {!b && loading ? (
                <div className="flex flex-col gap-3 p-3" aria-busy="true" aria-label="generating the brief">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="mt-2 h-3 w-1/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : !b ? (
                <div className="flex flex-col items-center gap-2.5 px-4 py-7 text-center text-xs leading-[1.5] text-muted-foreground">
                  <p className="max-w-[420px]">
                    The brief sends the headlines currently shown (window, search and filters applied, newest 250) to the model and
                    returns a headline, a recap, per-lane summaries with cited items, patterns with confidence, entity links that are
                    merged into the graph, and watch terms you can add in one click.
                  </p>
                  {p.briefState === "error" && p.briefError && <p className="text-[11.5px] text-destructive">{p.briefError}</p>}
                  {generate}
                </div>
              ) : (
                <div className="flex flex-col gap-3.5 px-3 pt-2.5 pb-5">
                  <div>
                    <div className="text-[15px] leading-[1.3] font-semibold">{b.headline}</div>
                    <div className={NOTE}>
                      {b.lanes.length} lanes · {b.patterns.length} patterns · {b.links.length} links
                      {b.error ? ` · ${b.error}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 text-[12.5px] leading-[1.45]">{renderMarkdown(b.recap)}</div>

                  {b.lanes.length > 0 && (
                    <div>
                      <SectionLabel>Lanes</SectionLabel>
                      {b.lanes.map((l) => {
                        const lc = LANE_CLASS[l.lane as LaneId];
                        return (
                          <div key={l.lane} className="border-t pt-1.5 pb-2">
                            <div className="mb-0.5 flex items-center gap-1.5">
                              <span className={cn("inline-block size-[7px] shrink-0 rounded-full", lc?.bg ?? "bg-muted-foreground")} aria-hidden="true" />
                              <span className={cn("text-[11px] tracking-[0.06em] uppercase", lc?.text)}>{LANE_BY_ID[l.lane as LaneId]?.label ?? l.lane}</span>
                              <span className={CNT}>{l.itemIds.length}</span>
                            </div>
                            <div className="text-[12.5px] leading-[1.45]">{inline(l.summary, `l-${l.lane}`)}</div>
                            <Cites ids={l.itemIds} items={p.items} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {b.patterns.length > 0 && (
                    <div>
                      <SectionLabel>Patterns</SectionLabel>
                      {b.patterns.map((pt, i) => {
                        const pct = Math.round(pt.confidence * 100);
                        return (
                          <div key={i} className="border-t pt-1.5 pb-2">
                            <div className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 font-medium">{pt.title}</span>
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums" title="model confidence">{pct}%</span>
                            </div>
                            {pt.detail && <div className="mt-0.5 text-xs leading-[1.4] text-muted-foreground">{pt.detail}</div>}
                            <ScoreBar pct={pct} />
                            <Cites ids={pt.itemIds} items={p.items} max={3} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {b.links.length > 0 && (
                    <div>
                      <SectionLabel>Links</SectionLabel>
                      <div className="rounded-md border">
                        <Table className="text-xs">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="h-7 px-2 text-[10.5px] font-normal tracking-[0.06em] text-muted-foreground uppercase">Source</TableHead>
                              <TableHead className="h-7 px-2 text-[10.5px] font-normal tracking-[0.06em] text-muted-foreground uppercase">Kind</TableHead>
                              <TableHead className="h-7 px-2 text-[10.5px] font-normal tracking-[0.06em] text-muted-foreground uppercase">Target</TableHead>
                              <TableHead className="h-7 px-2 text-[10.5px] font-normal tracking-[0.06em] text-muted-foreground uppercase">Label</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {b.links.map((l, i) => (
                              <TableRow key={i}>
                                <TableCell className="px-2 py-1 align-top">
                                  <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs font-medium" onClick={() => p.onSearch(l.source)} title="Search this entity">{l.source}</Button>
                                </TableCell>
                                <TableCell className="px-2 py-1 align-top">
                                  <Badge variant="outline" className={cn(KIND_BADGE, "border-lane-power/50 text-lane-power")}>{l.kind}</Badge>
                                </TableCell>
                                <TableCell className="px-2 py-1 align-top">
                                  <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs font-medium" onClick={() => p.onSearch(l.target)} title="Search this entity">{l.target}</Button>
                                </TableCell>
                                <TableCell className="px-2 py-1 align-top text-[11.5px] whitespace-normal text-muted-foreground">
                                  {l.label}
                                  {l.itemIds.length > 0 && <div className="font-mono text-[10px]">{l.itemIds.slice(0, 4).join(" ")}</div>}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {b.watch.length > 0 && (
                    <div>
                      <SectionLabel>Suggested watch terms</SectionLabel>
                      <div className="flex flex-wrap gap-1">
                        {b.watch.map((w) => {
                          const on = have.has(fold(w));
                          return (
                            <Badge key={w} variant="outline" className={cn("h-6 gap-1 rounded-full pr-0.5 pl-2 text-[11.5px] font-normal", on && "opacity-55")}>
                              {w}
                              {on ? (
                                <span className="inline-flex size-5 items-center justify-center text-muted-foreground" title="already on the watchlist">
                                  <Check className="size-3" aria-hidden="true" />
                                </span>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-5 rounded-full text-primary hover:text-foreground max-[859px]:size-8"
                                  aria-label={`Add ${w} to watchlist`}
                                  title="Add to watchlist"
                                  onClick={() => p.onAddWatch(w)}
                                >
                                  <Plus className="size-3" />
                                </Button>
                              )}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const IntelPanel = memo(IntelPanelBase);
export default IntelPanel;
