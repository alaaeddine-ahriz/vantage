"use client";

import { memo, useMemo, useState, type MouseEvent } from "react";
import {
  absoluteTime, highlight, relativeTime, LANE_BY_ID, REGION_CODE, REGION_LABEL, WIRE_SOURCES,
  type Item, type Matcher,
} from "./util";

export interface NewsRowProps {
  item: Item;
  matcher: Matcher | null;
  hit: boolean;
  saved: boolean;
  isNew: boolean;
  now: number;
  showLane: boolean;
  onStar: (item: Item) => void;
}

function NewsRowBase({ item, matcher, hit, saved, isNew, now, showLane, onStar }: NewsRowProps) {
  const [open, setOpen] = useState(false);
  const title = useMemo(() => highlight(item.title, matcher), [item.title, matcher]);
  const wire = WIRE_SOURCES.has(item.sourceId) && !!item.publisher;
  const toggle = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a, .star")) return;
    setOpen((o) => !o);
  };
  const cls = `row${hit ? " hit" : ""}${open ? " open" : ""}`;
  return (
    <article className={cls} onClick={toggle}>
      <div className="rmain">
        <button
          type="button"
          className="rmeta"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} details`}
        >
          <span className="rtime" title={absoluteTime(item.ts)}>{relativeTime(item.ts, now)}</span>
          {isNew && <span className="new">new</span>}
          {showLane && <span className={`tag lc-${item.lane}`}>{LANE_BY_ID[item.lane]?.short ?? item.lane}</span>}
          <span className="rsrc" title={wire ? `${item.publisher} via ${item.source}` : item.source}>
            {wire ? item.publisher : item.source}
            {wire && <span className="muted"> via wire</span>}
          </span>
          <span className="rreg" title={REGION_LABEL[item.region]}>{REGION_CODE[item.region]}</span>
          {/* the language tag is dropped when it would only restate the region ("FR [FR]") */}
          {item.lang !== "en" && item.lang.toUpperCase() !== REGION_CODE[item.region] && <span className="tag">{item.lang}</span>}
        </button>
        <a className="rtitle" href={item.link} target="_blank" rel="noopener noreferrer">{title}</a>
        {open && (
          <div className="rmore">
            {item.summary && <p className="rsum">{highlight(item.summary, matcher)}</p>}
            <div className="chips">
              {item.lanes.map((l) => (
                <span key={l} className={`tag lc-${l}`}>{LANE_BY_ID[l]?.label ?? l}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className={`star${saved ? " on" : ""}`}
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved" : "Save item"}
        onClick={() => onStar(item)}
      >
        {saved ? "★" : "☆"}
      </button>
    </article>
  );
}

const NewsRow = memo(NewsRowBase);
export default NewsRow;
