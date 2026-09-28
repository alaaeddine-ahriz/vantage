"use client";

import { useMemo, useState } from "react";
import type { LaneId } from "@/lib/types";
import NewsRow from "./NewsRow";
import { LANE_BY_ID, PAGE, type Item, type Matcher, type View } from "./util";

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

export default function LaneBoard({ items, view, lanes, narrow, loading, ...ctx }: Props) {
  const [tab, setTab] = useState<LaneId | null>(null);
  const byLane = useMemo(() => {
    const m = new Map<LaneId, Item[]>();
    for (const l of lanes) m.set(l, []);
    for (const it of items) m.get(it.lane)?.push(it);
    return m;
  }, [items, lanes]);
  const empty = loading ? "loading feeds" : "nothing matches the current filters";

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
        <div className="lanetabs" role="tablist" aria-label="Lanes">
          {lanes.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={l === active}
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

  return (
    <div className="board">
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
    </div>
  );
}
