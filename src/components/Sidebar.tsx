"use client";

import { memo, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Lang, Region, SourceStatus } from "@/lib/types";
import { LANES, LANGS, REGIONS } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import Section from "./Section";
import { toggleIn, LANE_CLASS, WINDOWS, type Counts, type Prefs, type WindowId } from "./util";

export interface SidebarProps {
  prefs: Prefs;
  counts: Counts;
  statusById: Map<string, SourceStatus>;
  narrow: boolean;
  update: (patch: Partial<Prefs>) => void;
  /** Panel and section ids currently folded. */
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  /** Phone only: the filters live in a sheet opened from the top bar. */
  sheetOpen: boolean;
  onSheetOpen: (open: boolean) => void;
}

const CHIP = "h-6 flex-none gap-1 rounded-md border-l px-2 text-[11px] data-[variant=outline]:border-l";
const COUNT = "font-mono text-[10px] text-muted-foreground tabular-nums";

function SidebarBase({ prefs, counts, statusById, narrow, update, collapsed, onToggle, sheetOpen, onSheetOpen }: SidebarProps) {
  const disabled = useMemo(() => new Set(prefs.disabledSources), [prefs.disabledSources]);
  const enabledSources = SOURCES.length - SOURCES.filter((s) => disabled.has(s.id)).length;
  const isOpen = (id: string) => !collapsed.has(id);
  /* the whole panel folds to a rail on desktop; on a phone the sheet already does that job */
  const railed = !narrow && collapsed.has("sidebar");
  const linkBtn = (label: string, aria: string, onClick: () => void) => (
    <Button type="button" variant="link" size="sm" className="h-5 px-1 text-[10px] text-muted-foreground" aria-label={aria} onClick={onClick}>
      {label}
    </Button>
  );

  const body = (
    <>
      <Section id="window" title="Window" open={isOpen("window")} onToggle={onToggle} summary={prefs.window}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={prefs.window}
          onValueChange={(v) => v && update({ window: v as WindowId })}
          aria-label="Time window"
          className="w-full"
        >
          {WINDOWS.map((w) => (
            <ToggleGroupItem key={w.id} value={w.id} className="h-7 px-0 text-[11px]">
              {w.id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section
        id="lanes"
        title="Lanes"
        count={`${prefs.lanes.length}/${LANES.length}`}
        open={isOpen("lanes")}
        onToggle={onToggle}
        summary={prefs.lanes.length === LANES.length ? "all lanes" : prefs.lanes.length ? LANES.filter((l) => prefs.lanes.includes(l.id)).map((l) => l.label).join(", ") : "no lanes"}
        actions={
          <>
            {linkBtn("all", "Enable all lanes", () => update({ lanes: LANES.map((l) => l.id) }))}
            {linkBtn("none", "Disable all lanes", () => update({ lanes: [] }))}
          </>
        }
      >
        <div className="flex flex-col gap-px">
          {LANES.map((l) => {
            const on = prefs.lanes.includes(l.id);
            const id = `lane-${l.id}`;
            return (
              <div key={l.id} className={cn("flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent/60", !on && "text-muted-foreground")}>
                <Checkbox id={id} checked={on} onCheckedChange={() => update({ lanes: toggleIn(prefs.lanes, l.id) })} className="size-3.5" />
                <span className={cn("size-[7px] shrink-0 rounded-full", LANE_CLASS[l.id].bg)} aria-hidden="true" />
                <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-xs font-normal">
                  {l.label}
                </Label>
                <span className={COUNT}>{counts.lane[l.id] ?? 0}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        id="regions"
        title="Regions"
        count={`${prefs.regions.length}/${REGIONS.length}`}
        open={isOpen("regions")}
        onToggle={onToggle}
        summary={prefs.regions.length === REGIONS.length ? "all regions" : prefs.regions.length ? REGIONS.filter((r) => prefs.regions.includes(r.id)).map((r) => r.label).join(", ") : "no regions"}
      >
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={prefs.regions}
          onValueChange={(v) => update({ regions: v as Region[] })}
          aria-label="Regions"
          className="flex-wrap gap-1"
        >
          {REGIONS.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id} className={CHIP} aria-label={r.label}>
              {r.label} <span className={COUNT}>{counts.region[r.id] ?? 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section
        id="langs"
        title="Language"
        open={isOpen("langs")}
        onToggle={onToggle}
        summary={prefs.langs.length === LANGS.length ? "all languages" : prefs.langs.length ? LANGS.filter((l) => prefs.langs.includes(l.id)).map((l) => l.label).join(", ") : "no languages"}
      >
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={prefs.langs}
          onValueChange={(v) => update({ langs: v as Lang[] })}
          aria-label="Languages"
          className="flex-wrap gap-1"
        >
          {LANGS.map((l) => (
            <ToggleGroupItem key={l.id} value={l.id} className={CHIP} aria-label={l.label}>
              {l.label} <span className={COUNT}>{counts.lang[l.id] ?? 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section
        id="sources"
        title="Sources"
        count={`${enabledSources}/${SOURCES.length}`}
        open={isOpen("sources")}
        onToggle={onToggle}
        actions={
          <>
            {linkBtn("all", "Enable all sources", () => update({ disabledSources: [] }))}
            {linkBtn("none", "Disable all sources", () => update({ disabledSources: SOURCES.map((s) => s.id) }))}
          </>
        }
      >
        <div className="flex flex-col gap-px">
          {SOURCES.map((s) => {
            const st = statusById.get(s.id);
            const state = !st ? "pending" : st.ok ? "ok" : "failed";
            const off = disabled.has(s.id);
            const id = `src-${s.id}`;
            return (
              <div key={s.id} className="grid grid-cols-[7px_minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-sm px-0.5 py-px text-[11px] hover:bg-accent/60">
                <span className={cn("size-[7px] rounded-full", state === "ok" ? "bg-up" : state === "failed" ? "bg-down" : "bg-muted-foreground")} title={state} />
                <Label htmlFor={id} className={cn("min-w-0 cursor-pointer truncate text-[11px] font-normal", off && "text-muted-foreground")} title={`${s.name} (${state})`}>
                  {s.name}
                </Label>
                <span className={COUNT}>{counts.src[s.id] ?? 0}</span>
                <Checkbox id={id} checked={!off} aria-label={`Enable ${s.name}`} onCheckedChange={() => update({ disabledSources: toggleIn(prefs.disabledSources, s.id) })} className="size-3.5" />
                {st && !st.ok && <span className="col-start-2 col-end-5 truncate text-[11px] text-muted-foreground" title={st.error}>{st.error || "failed"}</span>}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );

  if (narrow) {
    return (
      <Sheet open={sheetOpen} onOpenChange={onSheetOpen}>
        <SheetContent side="left" className="w-[280px] gap-0 p-0" aria-label="Filters">
          <SheetHeader className="border-b px-3 py-2.5">
            <SheetTitle className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Filters</SheetTitle>
            <SheetDescription className="text-[11px]">
              {prefs.window} · {prefs.lanes.length}/{LANES.length} lanes · {enabledSources} sources
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-3 py-2.5 pb-6">{body}</div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  if (railed) {
    return (
      <aside className="overflow-hidden border-r bg-card min-[860px]:max-[1179px]:row-span-2" aria-label="Filters (collapsed)">
        <Button
          type="button"
          variant="ghost"
          className="h-full w-full flex-col justify-start gap-2 rounded-none px-0 py-2 text-muted-foreground hover:text-foreground"
          aria-expanded={false}
          onClick={() => onToggle("sidebar")}
          title="Expand filters"
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <span className="rotate-180 text-[10.5px] tracking-[0.06em] whitespace-nowrap [writing-mode:vertical-rl]">
            Filters · {prefs.window} · {prefs.lanes.length}/{LANES.length} lanes
          </span>
        </Button>
      </aside>
    );
  }

  return (
    <aside className="min-h-0 overflow-y-auto border-r bg-card px-3 pt-2.5 pb-5 min-[860px]:max-[1179px]:row-span-2" aria-label="Filters">
      <div className="mb-2 flex items-center justify-between border-b pb-1.5">
        <span className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Filters</span>
        <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={() => onToggle("sidebar")} aria-expanded={true} title="Collapse filters" aria-label="Collapse filters">
          <ChevronLeft className="size-3.5" />
        </Button>
      </div>
      {body}
    </aside>
  );
}

const Sidebar = memo(SidebarBase);
export default Sidebar;
