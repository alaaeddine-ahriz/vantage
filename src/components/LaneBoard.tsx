"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LaneId } from "@/lib/types";
import NewsRow from "./NewsRow";
import { LANE_BY_ID, PAGE, type Item, type Matcher, type View } from "./util";

/** Narrowest lane column; below that the board folds lanes onto another row instead of scrolling sideways. */
const MIN_LANE_PX = 300;

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

function List({ items, showLane, empty, ctx }: { items: Item[]; showLane: boolean; empty: string; ctx: RowCtx }) {
  const [limit, setLimit] = useState(PAGE);
  if (!items.length) return <div className="empty">{empty}</div>;
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
        <button type="button" className="more" onClick={() => setLimit((l) => l + PAGE)}>
          show {Math.min(PAGE, rest)} more ({rest} hidden)
        </button>
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
    return (
      <div className="stream">
        <List items={items} showLane empty={empty} ctx={ctx} />
      </div>
    );
  }
  if (!lanes.length) return <div className="empty">no lanes enabled</div>;

  if (narrow) {
    const active = tab && lanes.includes(tab) ? tab : lanes[0];
    return (
      <div className="board">
        <div className="lanetabs" role="group" aria-label="Lanes">
          {lanes.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === active}
              aria-label={`${LANE_BY_ID[l].label}, ${byLane.get(l)?.length ?? 0} items`}
              className={`lc-${l}${l === active ? " on" : ""}`}
              onClick={() => setTab(l)}
            >
              <span className="dot" />
              {LANE_BY_ID[l].short}
              <span className="cnt">{byLane.get(l)?.length ?? 0}</span>
            </button>
          ))}
        </div>
        <section className="lane" aria-label={LANE_BY_ID[active].label}>
          <div className="lanelist">
            <List items={byLane.get(active) ?? []} showLane={false} empty={empty} ctx={ctx} />
          </div>
        </section>
      </div>
    );
  }

  const { rows, cols } = gridFor(lanes.length, width);
  const fillers = rows * cols - lanes.length;
  return (
    <div
      className="board"
      ref={boardRef}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {lanes.map((l) => {
        const list = byLane.get(l) ?? [];
        return (
          <section key={l} className={`lane lc-${l}`} aria-label={LANE_BY_ID[l].label}>
            <header className="lanehead">
              <span className="dot" />
              <span className="lbl">{LANE_BY_ID[l].label}</span>
              <span className="cnt">{list.length}</span>
            </header>
            <div className="lanelist">
              <List items={list} showLane={false} empty={empty} ctx={ctx} />
            </div>
          </section>
        );
      })}
      {Array.from({ length: fillers }, (_, i) => (
        <div key={`fill-${i}`} className="lane fill" aria-hidden="true" />
      ))}
    </div>
  );
}
