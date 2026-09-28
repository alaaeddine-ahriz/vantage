"use client";

import { memo, type RefObject } from "react";
import { Moon, RefreshCw, Search, SlidersHorizontal, Star, Sun, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { countdown, fmtInt, useNow, utcClock, VIEWS, type Theme, type View } from "./util";

export interface TopBarProps {
  updatedAt: number;
  nextAt: number;
  loading: boolean;
  shown: number;
  total: number;
  ok: number;
  failed: number;
  batchErrors: number;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  view: View;
  /** ISO2 selected on the globe; null when no country filter is active. */
  country: string | null;
  watchOnly: boolean;
  theme: Theme;
  onSearch: (s: string) => void;
  onView: (v: View) => void;
  onCountry: (iso2: string | null) => void;
  onWatchOnly: () => void;
  onTheme: () => void;
  onRefresh: () => void;
  /** Opens the filters sheet; the button only shows on phones. */
  onFilters: () => void;
}

function TopBarBase(p: TopBarProps) {
  const now = useNow(1000);
  const next = p.nextAt && now ? `next in ${countdown(p.nextAt - now)}` : "next in -:--";
  const status = p.updatedAt ? `updated ${utcClock(p.updatedAt, false)}` : p.loading || !p.batchErrors ? "loading" : "no data";
  return (
    <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-4 py-1 max-[859px]:min-h-0 max-[859px]:gap-x-2 max-[859px]:px-3">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] whitespace-nowrap">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-up shadow-[0_0_0_2px_color-mix(in_oklab,var(--up)_20%,transparent)]" aria-hidden="true" />
        VANTAGE
        <small className="hidden text-[11px] font-normal tracking-[0.02em] text-muted-foreground min-[1800px]:inline">energy · industry · markets</small>
      </div>
      <div className="font-mono text-[13px] tabular-nums whitespace-nowrap" title="Coordinated Universal Time">
        {now ? utcClock(now) : "--:--:--"} <span className="text-muted-foreground">UTC</span>
      </div>
      <div className="font-mono text-xs whitespace-nowrap text-muted-foreground" aria-live="off">
        {status}
        {/* the countdown is desktop-only: on a phone it costs a whole top-bar row */}
        <span className="max-[859px]:hidden"> · {p.loading ? "refreshing" : next}</span>
        {p.batchErrors > 0 && (
          <span className="text-down" title="Feed batches that could not be fetched this round; their previous headlines are kept">
            {" "}· {p.batchErrors} batch{p.batchErrors > 1 ? "es" : ""} failed
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 max-[859px]:hidden">
        <Badge variant="secondary" className="h-6 gap-1 font-normal text-muted-foreground" title="items shown / items loaded">
          <b className="font-medium text-foreground">{fmtInt(p.shown)}</b> / {fmtInt(p.total)} items
        </Badge>
        <Badge variant="outline" className="h-6 gap-1.5 font-normal text-muted-foreground" title="source health">
          <span className="size-[7px] rounded-full bg-up" aria-hidden="true" /> {p.ok} ok
          <span className="size-[7px] rounded-full bg-down" aria-hidden="true" /> {p.failed} failed
        </Badge>
      </div>
      <div className="relative min-w-0 flex-[1_1_180px] max-w-[420px] min-[860px]:max-[1799px]:max-w-[260px] max-[859px]:flex-[1_1_120px] max-[859px]:max-w-none">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={p.searchRef}
          type="text"
          className="h-8 pl-7 text-xs md:text-xs"
          placeholder="search headlines   /"
          aria-label="Search headlines (press / to focus, Esc to clear)"
          value={p.search}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => p.onSearch(e.target.value)}
        />
      </div>
      <div className="ml-auto flex max-w-full items-center gap-1.5 max-[859px]:ml-0">
        <Button type="button" variant="outline" size="sm" className="h-8 min-[860px]:hidden" onClick={p.onFilters} aria-label="Open filters">
          <SlidersHorizontal /> Filters
        </Button>
        {p.country && (
          <Badge variant="outline" className="h-8 gap-1 border-primary pr-0.5 text-primary" title="Country filter">
            country: <b className="font-semibold">{p.country}</b>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-primary hover:text-foreground"
              onClick={() => p.onCountry(null)}
              title="Clear the country filter"
              aria-label={`Clear country filter ${p.country}`}
            >
              <X className="size-3.5" />
            </Button>
          </Badge>
        )}
        <Tabs value={p.view} onValueChange={(v) => p.onView(v as View)} className="min-w-0 max-[859px]:flex-1">
          <TabsList aria-label="View" className="h-8 max-[859px]:w-full max-[859px]:justify-start max-[859px]:overflow-x-auto">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.id} value={v.id} className="px-2.5 text-xs max-[859px]:flex-none min-[860px]:max-[1799px]:px-2" title={`${v.label} view (v cycles)`}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Toggle
          size="sm"
          pressed={p.watchOnly}
          onPressedChange={p.onWatchOnly}
          aria-label="Watchlist hits only (w)"
          title="Filter to watchlist hits only (w)"
          className="h-8 gap-1 text-xs text-muted-foreground data-[state=on]:text-primary"
        >
          <Star className={cn("size-3.5", p.watchOnly && "fill-current")} aria-hidden="true" />
          <span className="max-[859px]:hidden">hits only</span>
        </Toggle>
        <Toggle
          size="sm"
          pressed={p.theme === "light"}
          onPressedChange={p.onTheme}
          aria-label={`Switch to ${p.theme === "dark" ? "light" : "dark"} theme (t)`}
          title="Theme (t)"
          className="size-8 px-0 text-muted-foreground data-[state=on]:bg-transparent data-[state=on]:text-muted-foreground hover:text-foreground"
        >
          {p.theme === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </Toggle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={p.onRefresh}
          disabled={p.loading}
          aria-label="Refresh feeds (r)"
          title="Refresh (r)"
        >
          <RefreshCw className={cn("size-3.5", p.loading && "animate-spin")} />
        </Button>
      </div>
    </header>
  );
}

const TopBar = memo(TopBarBase);
export default TopBar;
