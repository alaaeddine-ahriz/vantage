"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LaneId } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import NewsRow from "./NewsRow";
import { LANE_BY_ID, LANE_CLASS, PAGE, type Item, type Matcher, type View } from "./util";

/** Narrowest lane column; below that the board folds lanes onto another row instead of scrolling sideways. */
const MIN_LANE_PX = 300;

/* Radix renders the viewport's child as display:table, which would grow to fit a non-wrapping meta line; block keeps rows at the lane's width. */
const LIST_AREA = "min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!";

interface RowCtx {
  matcher: Matcher | null;
  hits: Set<string>;
  savedIds: Set<string>;
  newIds: Set<string>;
  now: number;
  onStar: (item: Item) => void;
}

interface Props extends RowCtx {
  items: Item[];
  view: View;
  lanes: LaneId[];
  narrow: boolean;
  loading: boolean;
  /** true when the first refresh finished with nothing loaded and at least one batch failed. */
  failed: boolean;
}

function Empty({ text, loading }: { text: string; loading: boolean }) {
  return (
    <div className="p-6 text-center text-xs text-muted-foreground" role="status">
      {loading && (
        <div className="mb-4 flex flex-col gap-3" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      )}
      {text}
    </div>
  );
}

function List({ items, showLane, empty, loading, ctx }: { items: Item[]; showLane: boolean; empty: string; loading: boolean; ctx: RowCtx }) {
  const [limit, setLimit] = useState(PAGE);
  if (!items.length) return <Empty text={empty} loading={loading} />;
  const shown = limit < items.length ? items.slice(0, limit) : items;
  const rest = items.length - shown.length;
  return (
    <>
      {shown.map((it) => (
        <NewsRow
          key={it.id}
          item={it}
          matcher={ctx.matcher}
          hit={ctx.hits.has(it.id)}
          saved={ctx.savedIds.has(it.id)}
          isNew={ctx.newIds.has(it.id)}
          now={ctx.now}
          showLane={showLane}
          onStar={ctx.onStar}
        />
      ))}
      {rest > 0 && (
        <Button type="button" variant="ghost" size="sm" className="h-8 w-full rounded-none border-b text-[11px] text-muted-foreground" onClick={() => setLimit((l) => l + PAGE)}>
          show {Math.min(PAGE, rest)} more ({rest} hidden)
        </Button>
      )}
    </>
  );
}

/** Width of an element, measured before first paint and kept current by a ResizeObserver. */
function useWidth<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return { ref, width };
}

/**
 * As many columns as fit at MIN_LANE_PX, then the lanes spread evenly over the rows that needs:
 * 6 lanes on a 1080px board give 3 by 2, 4 lanes give 2 by 2, 6 lanes on 1800px give one row.
 */
function gridFor(n: number, width: number) {
  const maxCols = Math.max(1, Math.floor(width / MIN_LANE_PX));
  const rows = Math.max(1, Math.ceil(n / maxCols));
  const cols = Math.max(1, Math.ceil(n / rows));
  return { rows, cols };
}

export default function LaneBoard({ items, view, lanes, narrow, loading, failed, ...ctx }: Props) {
  const [tab, setTab] = useState<LaneId | null>(null);
  const { ref: boardRef, width } = useWidth<HTMLDivElement>(!narrow && view === "lanes" && lanes.length > 0);
  const byLane = useMemo(() => {
    const m = new Map<LaneId, Item[]>();
    for (const l of lanes) m.set(l, []);
    for (const it of items) m.get(it.lane)?.push(it);
    return m;
  }, [items, lanes]);
  const empty = loading ? "loading feeds" : failed ? "feeds unavailable, press r to retry" : "nothing matches the current filters";

  if (view === "stream") {
    if (narrow) return <List items={items} showLane empty={empty} loading={loading} ctx={ctx} />;
    return (
      <ScrollArea className={LIST_AREA}>
        <List items={items} showLane empty={empty} loading={loading} ctx={ctx} />
      </ScrollArea>
    );
  }
  if (!lanes.length) return <Empty text="no lanes enabled" loading={false} />;

  if (narrow) {
    const active = tab && lanes.includes(tab) ? tab : lanes[0];
    return (
      <div>
        <ToggleGroup
          type="single"
          value={active}
          onValueChange={(v) => v && setTab(v as LaneId)}
          aria-label="Lanes"
          className="sticky top-0 z-20 w-full rounded-none border-b bg-card"
        >
          {lanes.map((l) => (
            <ToggleGroupItem
              key={l}
              value={l}
              aria-label={`${LANE_BY_ID[l].label}, ${byLane.get(l)?.length ?? 0} items`}
              className={cn(
                "h-9 min-w-0 flex-1 gap-1 rounded-none border-b-2 border-transparent px-1 text-[11px] text-muted-foreground first:rounded-none last:rounded-none data-[state=on]:bg-transparent data-[state=on]:text-foreground",
                l === active && LANE_CLASS[l].border,
              )}
            >
              <span className={cn("size-[7px] shrink-0 rounded-full", LANE_CLASS[l].bg)} aria-hidden="true" />
              {LANE_BY_ID[l].short}
              <span className="font-mono text-[10px] tabular-nums">{byLane.get(l)?.length ?? 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <section aria-label={LANE_BY_ID[active].label}>
          <List items={byLane.get(active) ?? []} showLane={false} empty={empty} loading={loading} ctx={ctx} />
        </section>
      </div>
    );
  }

  const { rows, cols } = gridFor(lanes.length, width);
  const fillers = rows * cols - lanes.length;
  return (
    <div
      className="grid min-h-0 flex-1 gap-px overflow-hidden bg-border"
      ref={boardRef}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {lanes.map((l) => {
        const list = byLane.get(l) ?? [];
        return (
          <Card key={l} className="min-h-0 min-w-0 gap-0 rounded-none border-0 bg-background py-0 shadow-none" aria-label={LANE_BY_ID[l].label}>
            <CardHeader className="sticky top-0 z-10 flex flex-row items-center gap-2 border-b bg-card px-2.5 py-1.5 [.border-b]:pb-1.5">
              <span className={cn("size-[7px] shrink-0 rounded-full", LANE_CLASS[l].bg)} aria-hidden="true" />
              <CardTitle className="text-[11px] font-semibold tracking-[0.08em] uppercase">{LANE_BY_ID[l].label}</CardTitle>
              <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
                {list.length}
              </Badge>
            </CardHeader>
            <ScrollArea className={LIST_AREA}>
              <List items={list} showLane={false} empty={empty} loading={loading} ctx={ctx} />
            </ScrollArea>
          </Card>
        );
      })}
      {Array.from({ length: fillers }, (_, i) => (
        <div key={`fill-${i}`} className="bg-background" aria-hidden="true" />
      ))}
    </div>
  );
}
