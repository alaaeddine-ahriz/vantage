"use client";

import { memo, useMemo, useState, type MouseEvent } from "react";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  absoluteTime, highlight, relativeTime, LANE_BY_ID, LANE_CLASS, REGION_CODE, REGION_LABEL, WIRE_SOURCES,
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

const TAG = "h-4 rounded-sm px-1 text-[10px] font-normal tracking-[0.04em] uppercase";

function NewsRowBase({ item, matcher, hit, saved, isNew, now, showLane, onStar }: NewsRowProps) {
  const [open, setOpen] = useState(false);
  const title = useMemo(() => highlight(item.title, matcher), [item.title, matcher]);
  const wire = WIRE_SOURCES.has(item.sourceId) && !!item.publisher;
  const toggle = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a, [data-slot=button]")) return;
    setOpen((o) => !o);
  };
  return (
    <article
      className={cn(
        "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-1.5 border-b border-l-2 border-l-transparent px-2 py-1.5 hover:bg-accent/40 max-[859px]:px-3",
        hit && "border-l-primary",
      )}
      onClick={toggle}
    >
      <div className="min-w-0">
        <button
          type="button"
          className="flex w-full items-baseline gap-1.5 overflow-hidden text-left text-[11px] whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} details`}
        >
          <span className="min-w-6 font-mono text-foreground tabular-nums" title={absoluteTime(item.ts)}>{relativeTime(item.ts, now)}</span>
          {isNew && <Badge className={cn(TAG, "border-transparent bg-up/15 text-up")}>new</Badge>}
          {showLane && (
            <Badge variant="outline" className={cn(TAG, LANE_CLASS[item.lane].text)}>
              {LANE_BY_ID[item.lane]?.short ?? item.lane}
            </Badge>
          )}
          <span className="truncate" title={wire ? `${item.publisher} via ${item.source}` : item.source}>
            {wire ? item.publisher : item.source}
            {wire && <span className="text-muted-foreground/70"> via wire</span>}
          </span>
          <Badge variant="outline" className={cn(TAG, "font-mono text-muted-foreground")} title={REGION_LABEL[item.region]}>
            {REGION_CODE[item.region]}
          </Badge>
          {/* the language tag is dropped when it would only restate the region ("FR [FR]") */}
          {item.lang !== "en" && item.lang.toUpperCase() !== REGION_CODE[item.region] && (
            <Badge variant="outline" className={cn(TAG, "text-muted-foreground")}>{item.lang}</Badge>
          )}
        </button>
        <a
          className={cn("mt-px block leading-[1.35] hover:underline", !open && "line-clamp-2")}
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          {title}
        </a>
        {open && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {item.summary && <p className="text-xs leading-[1.45] text-muted-foreground">{highlight(item.summary, matcher)}</p>}
            <div className="flex flex-wrap gap-1">
              {item.lanes.map((l) => (
                <Badge key={l} variant="outline" className={cn(TAG, LANE_CLASS[l]?.text)}>
                  {LANE_BY_ID[l]?.label ?? l}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-7 self-start text-muted-foreground hover:text-primary max-[859px]:size-8", saved && "text-primary")}
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved" : "Save item"}
        onClick={() => onStar(item)}
      >
        <Star className={cn("size-3.5", saved && "fill-current")} aria-hidden="true" />
      </Button>
    </article>
  );
}

const NewsRow = memo(NewsRowBase);
export default NewsRow;
