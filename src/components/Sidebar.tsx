"use client";

import { memo, useMemo, useState } from "react";
import type { SourceStatus } from "@/lib/types";
import { LANES, LANGS, REGIONS } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import Section from "./Section";
import { toggleIn, WINDOWS, type Counts, type Prefs } from "./util";

export interface SidebarProps {
  prefs: Prefs;
  counts: Counts;
  statusById: Map<string, SourceStatus>;
  narrow: boolean;
  update: (patch: Partial<Prefs>) => void;
  /** Panel and section ids currently folded. */
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}

function SidebarBase({ prefs, counts, statusById, narrow, update, collapsed, onToggle }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const disabled = useMemo(() => new Set(prefs.disabledSources), [prefs.disabledSources]);
  const enabledSources = SOURCES.length - SOURCES.filter((s) => disabled.has(s.id)).length;
  const isOpen = (id: string) => !collapsed.has(id);
  /* the whole panel folds to a rail on desktop; on a phone the Filters button already does that job */
  const railed = !narrow && collapsed.has("sidebar");

  const body = (
    <>
      <Section id="window" title="Window" open={isOpen("window")} onToggle={onToggle} summary={prefs.window}>
        <div className="seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" className={prefs.window === w.id ? "on" : ""} aria-pressed={prefs.window === w.id} onClick={() => update({ window: w.id })}>
              {w.id}
            </button>
          ))}
        </div>
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
            <button type="button" aria-label="Enable all lanes" onClick={() => update({ lanes: LANES.map((l) => l.id) })}>all</button>
            <button type="button" aria-label="Disable all lanes" onClick={() => update({ lanes: [] })}>none</button>
          </>
        }
      >
        {LANES.map((l) => {
          const on = prefs.lanes.includes(l.id);
          return (
            <button key={l.id} type="button" className={`lrow lc-${l.id}${on ? " on" : ""}`} aria-pressed={on} onClick={() => update({ lanes: toggleIn(prefs.lanes, l.id) })}>
              <span className="dot" />
              <span>{l.label}</span>
              <span className="cnt">{counts.lane[l.id] ?? 0}</span>
            </button>
          );
        })}
      </Section>

      <Section
        id="regions"
        title="Regions"
        count={`${prefs.regions.length}/${REGIONS.length}`}
        open={isOpen("regions")}
        onToggle={onToggle}
        summary={prefs.regions.length === REGIONS.length ? "all regions" : prefs.regions.length ? REGIONS.filter((r) => prefs.regions.includes(r.id)).map((r) => r.label).join(", ") : "no regions"}
      >
        <div className="chips">
          {REGIONS.map((r) => {
            const on = prefs.regions.includes(r.id);
            return (
              <button key={r.id} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => update({ regions: toggleIn(prefs.regions, r.id) })}>
                {r.label} <span className="cnt">{counts.region[r.id] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        id="langs"
        title="Language"
        open={isOpen("langs")}
        onToggle={onToggle}
        summary={prefs.langs.length === LANGS.length ? "all languages" : prefs.langs.length ? LANGS.filter((l) => prefs.langs.includes(l.id)).map((l) => l.label).join(", ") : "no languages"}
      >
        <div className="chips">
          {LANGS.map((l) => {
            const on = prefs.langs.includes(l.id);
            return (
              <button key={l.id} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => update({ langs: toggleIn(prefs.langs, l.id) })}>
                {l.label} <span className="cnt">{counts.lang[l.id] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        id="sources"
        title="Sources"
        count={`${enabledSources}/${SOURCES.length}`}
        open={isOpen("sources")}
        onToggle={onToggle}
        actions={
          <>
            <button type="button" aria-label="Enable all sources" onClick={() => update({ disabledSources: [] })}>all</button>
            <button type="button" aria-label="Disable all sources" onClick={() => update({ disabledSources: SOURCES.map((s) => s.id) })}>none</button>
          </>
        }
      >
        <div className="srclist">
          {SOURCES.map((s) => {
            const st = statusById.get(s.id);
            const state = !st ? "pending" : st.ok ? "ok" : "failed";
            const off = disabled.has(s.id);
            return (
              <label key={s.id} className={`src${off ? " off" : ""}`}>
                <span className={`hdot ${state === "ok" ? "ok" : state === "failed" ? "bad" : ""}`} title={state} />
                <span className="nm" title={`${s.name} (${state})`}>{s.name}</span>
                <span className="cnt">{counts.src[s.id] ?? 0}</span>
                <input type="checkbox" checked={!off} aria-label={`Enable ${s.name}`} onChange={() => update({ disabledSources: toggleIn(prefs.disabledSources, s.id) })} />
                {st && !st.ok && <span className="err" title={st.error}>{st.error || "failed"}</span>}
              </label>
            );
          })}
        </div>
      </Section>
    </>
  );

  if (railed) {
    return (
      <aside className="sidebar rail" aria-label="Filters (collapsed)">
        <button type="button" className="plain railbtn" aria-expanded={false} onClick={() => onToggle("sidebar")} title="Expand filters">
          <span aria-hidden="true">▸</span>
          <span className="railtxt">Filters · {prefs.window} · {prefs.lanes.length}/{LANES.length} lanes</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar" aria-label="Filters">
      {narrow ? (
        <button type="button" className="filtersbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>Filters {open ? "▴" : "▾"}</span>
          <span className="muted">{prefs.window} · {prefs.lanes.length}/{LANES.length} lanes · {enabledSources} sources</span>
        </button>
      ) : (
        <div className="panelhead">
          <span className="lbl">Filters</span>
          <button type="button" className="plain" onClick={() => onToggle("sidebar")} aria-expanded={true} title="Collapse filters" aria-label="Collapse filters">
            ◂
          </button>
        </div>
      )}
      {(!narrow || open) && body}
    </aside>
  );
}

const Sidebar = memo(SidebarBase);
export default Sidebar;
