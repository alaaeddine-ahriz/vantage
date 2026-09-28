"use client";

import { memo, useCallback, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import Section from "./Section";
import { exportCsv, exportMd, relativeTime, type Health } from "./util";

/** Failed sources listed before the panel folds the rest behind a "+N more" button. */
const FAILED_SHOWN = 6;

/** One check of the /api/health response. */
interface HealthCheck {
  id: string;
  label: string;
  ok: boolean;
  status?: number;
  ms?: number;
  note?: string;
}

type DataHealth =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "done"; at: string; checks: HealthCheck[] };

function isCheck(v: unknown): v is HealthCheck {
  return !!v && typeof v === "object" && typeof (v as HealthCheck).id === "string" && typeof (v as HealthCheck).ok === "boolean";
}

export interface RightPanelProps {
  watchlist: string[];
  watchCounts: number[];
  saved: NewsItem[];
  health: Health;
  now: number;
  narrow: boolean;
  /** true from 1180px up, where the panel sits beside the board instead of under it. */
  wide: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onAddWatch: (term: string) => void;
  onRemoveWatch: (term: string) => void;
  onSearchTerm: (term: string) => void;
  onUnsave: (id: string) => void;
  onClearSaved: () => void;
}

const HDOT = "inline-block size-[7px] shrink-0 rounded-full";

function RightPanelBase(p: RightPanelProps) {
  const [term, setTerm] = useState("");
  const [allFailed, setAllFailed] = useState(false);
  const [data, setData] = useState<DataHealth>({ state: "idle" });
  const savedTs = useMemo(() => p.saved.map((s) => Date.parse(s.publishedAt) || 0), [p.saved]);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = term.trim();
    if (!t) return;
    p.onAddWatch(t);
    setTerm("");
  };
  const clear = () => {
    if (window.confirm(`Clear all ${p.saved.length} saved items?`)) p.onClearSaved();
  };
  const runHealth = useCallback(async () => {
    setData({ state: "loading" });
    try {
      const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) throw new Error("health endpoint not available");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { generatedAt?: string; checks?: unknown };
      const checks = Array.isArray(body.checks) ? body.checks.filter(isCheck) : [];
      setData({ state: "done", at: typeof body.generatedAt === "string" ? body.generatedAt : new Date().toISOString(), checks });
    } catch (e) {
      setData({ state: "error", message: e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : e.message) : "request failed" });
    }
  }, []);
  const h = p.health;
  const failedShown = allFailed ? h.failedList : h.failedList.slice(0, FAILED_SHOWN);
  const failedHidden = h.failedList.length - failedShown.length;
  const isOpen = (id: string) => !p.collapsed.has(id);
  const hitsTotal = p.watchCounts.reduce((a, b) => a + b, 0);
  const failing = data.state === "done" ? data.checks.filter((c) => !c.ok) : [];

  if (p.collapsed.has("right")) {
    const label = `${p.watchlist.length} terms · ${hitsTotal} hits · ${p.saved.length} saved · ${h.failed} failed`;
    /* a vertical rail beside the board; a flat bar when the panel sits under it */
    const flat = !p.wide;
    return (
      <aside className={cn("overflow-hidden bg-card", p.wide ? "border-l" : "border-t")} aria-label="Watchlist, saved items and source health (collapsed)">
        <Button
          type="button"
          variant="ghost"
          className={cn("w-full gap-2 rounded-none text-muted-foreground hover:text-foreground", flat ? "h-auto justify-start px-3 py-1.5" : "h-full flex-col justify-start px-0 py-2")}
          aria-expanded={false}
          onClick={() => p.onToggle("right")}
          title="Expand panel"
        >
          {flat ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronLeft className="size-3.5" aria-hidden="true" />}
          <span className={cn("text-[10.5px] tracking-[0.06em] whitespace-nowrap", !flat && "rotate-180 [writing-mode:vertical-rl]")}>{label}</span>
        </Button>
      </aside>
    );
  }

  return (
    <aside className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-card px-3 pt-2.5 pb-5", p.wide ? "border-l" : "border-t", p.narrow && "pb-6")} aria-label="Watchlist, saved items and source health">
      {!p.narrow && (
        <div className="flex items-center justify-between border-b pb-1.5">
          <span className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Workspace</span>
          <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={() => p.onToggle("right")} aria-expanded={true} title="Collapse panel" aria-label="Collapse panel">
            {p.wide ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
          </Button>
        </div>
      )}

      <Section variant="card" id="watchlist" title="Watchlist" count={p.watchlist.length} open={isOpen("watchlist")} onToggle={p.onToggle} summary={`${hitsTotal} hits in the current window`}>
        <form className="mb-1.5 flex gap-1" onSubmit={add}>
          <Input type="text" className="h-7 text-xs md:text-xs" value={term} placeholder="add term" aria-label="New watchlist term" onChange={(e) => setTerm(e.target.value)} />
          <Button type="submit" size="sm" className="h-7 px-2.5 text-xs">Add</Button>
        </form>
        <ul>
          {p.watchlist.map((w, i) => {
            const n = p.watchCounts[i] ?? 0;
            return (
              <li key={w} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 text-xs">
                <Button type="button" variant="ghost" size="sm" className={cn("h-6 min-w-0 justify-start px-1 text-xs font-normal", !n && "text-muted-foreground")} title="Search this term" onClick={() => p.onSearchTerm(w)}>
                  <span className="truncate">{w}</span>
                </Button>
                <Badge variant="secondary" className={cn("h-4 min-w-5 px-1 font-mono text-[10px] font-normal tabular-nums", n ? "text-primary" : "text-muted-foreground")} title="matches in the current window">
                  {n}
                </Badge>
                <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-foreground" aria-label={`Remove ${w} from watchlist`} onClick={() => p.onRemoveWatch(w)}>
                  <X className="size-3" />
                </Button>
              </li>
            );
          })}
          {!p.watchlist.length && <li className="text-xs text-muted-foreground">no terms: add one above</li>}
        </ul>
      </Section>

      <Section variant="card" id="saved" title="Saved" count={p.saved.length} open={isOpen("saved")} onToggle={p.onToggle} summary={p.saved.length ? `${p.saved.length} starred` : "nothing starred"}>
        {p.saved.length ? (
          <>
            <div className="mb-1.5 flex flex-wrap gap-1">
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => exportCsv(p.saved)}>Export CSV</Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => exportMd(p.saved)}>Export MD</Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={clear}>Clear</Button>
            </div>
            <ul>
              {p.saved.map((s, i) => (
                <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-1 border-b py-1 text-xs last:border-0">
                  <a className="hover:underline" href={s.link} target="_blank" rel="noopener noreferrer">{s.title}</a>
                  <Button type="button" variant="ghost" size="icon" className="row-span-2 size-6 self-start text-muted-foreground hover:text-foreground" aria-label="Remove from saved" onClick={() => p.onUnsave(s.id)}>
                    <X className="size-3" />
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {s.publisher ?? s.source} · <span className="font-mono tabular-nums">{relativeTime(savedTs[i], p.now)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">star a headline to keep it here</p>
        )}
      </Section>

      <Section variant="card" id="health" title="Source health" open={isOpen("health")} onToggle={p.onToggle} summary={`${h.ok} ok · ${h.failed} failed`}>
        <div className="mb-1.5 flex gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5"><span className={cn(HDOT, "bg-up")} aria-hidden="true" /> {h.ok} ok</span>
          <span className="inline-flex items-center gap-1.5"><span className={cn(HDOT, "bg-down")} aria-hidden="true" /> {h.failed} failed</span>
          <span className="inline-flex items-center gap-1.5"><span className={cn(HDOT, "bg-muted-foreground")} aria-hidden="true" /> {h.pending} pending</span>
        </div>
        {h.failedList.length > 0 && (
          <ul>
            {failedShown.map((s) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-px text-[11px]">
                <span className="truncate" title={s.name}>{s.name}</span>
                <span className="max-w-[140px] truncate font-mono text-muted-foreground" title={s.error}>{s.error || "failed"}</span>
              </li>
            ))}
          </ul>
        )}
        {(failedHidden > 0 || (allFailed && h.failedList.length > FAILED_SHOWN)) && (
          <Button type="button" variant="link" size="sm" className="h-5 px-0 text-[11px]" aria-expanded={allFailed} onClick={() => setAllFailed((o) => !o)}>
            {allFailed ? "show fewer" : `+${failedHidden} more`}
          </Button>
        )}
        <div className="mt-2 border-t pt-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Data health</span>
            <Button type="button" variant="link" size="sm" className="h-5 px-0 text-[11px]" onClick={() => void runHealth()} disabled={data.state === "loading"}>
              {data.state === "loading" ? "checking" : "run health check"}
            </Button>
          </div>
          {data.state === "error" && <p className="text-down">{data.message}</p>}
          {data.state === "done" && (
            <>
              <p className="text-muted-foreground">
                {data.checks.length - failing.length}/{data.checks.length} checks ok · <span className="font-mono tabular-nums">{data.at.slice(11, 16) || data.at}</span> UTC
              </p>
              {failing.length > 0 && (
                <Table className="text-[11px]">
                  <TableBody>
                    {failing.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="px-1 py-0.5 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn(HDOT, "bg-down")} aria-hidden="true" />
                            {c.label}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate px-1 py-0.5 text-right font-mono text-muted-foreground" title={c.note}>
                          {c.status ? `${c.status} ` : ""}{c.note ?? "failed"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </div>
      </Section>
    </aside>
  );
}

const RightPanel = memo(RightPanelBase);
export default RightPanel;
