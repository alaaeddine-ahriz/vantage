"use client";

import { memo, useMemo, useState } from "react";
import type { SourceStatus } from "@/lib/types";
import { LANES, LANGS, REGIONS } from "@/lib/types";
import { SOURCES } from "@/lib/sources";
import { toggleIn, WINDOWS, type Counts, type Prefs } from "./util";

export interface SidebarProps {
  prefs: Prefs;
  counts: Counts;
  statusById: Map<string, SourceStatus>;
  narrow: boolean;
  update: (patch: Partial<Prefs>) => void;
}

function SidebarBase({ prefs, counts, statusById, narrow, update }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const disabled = useMemo(() => new Set(prefs.disabledSources), [prefs.disabledSources]);
  const enabledSources = SOURCES.length - SOURCES.filter((s) => disabled.has(s.id)).length;

  const body = (
    <>
      <section className="sec">
        <div className="lbl">Window</div>
        <div className="seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" className={prefs.window === w.id ? "on" : ""} aria-pressed={prefs.window === w.id} onClick={() => update({ window: w.id })}>
              {w.id}
            </button>
          ))}
        </div>
      </section>

      <section className="sec">
        <div className="lbl">
          Lanes
          <span className="btns">
            <button type="button" onClick={() => update({ lanes: LANES.map((l) => l.id) })}>all</button>
            <button type="button" onClick={() => update({ lanes: [] })}>none</button>
          </span>
        </div>
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
      </section>

      <section className="sec">
        <div className="lbl">Regions</div>
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
      </section>

      <section className="sec">
        <div className="lbl">Language</div>
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
      </section>

      <section className="sec">
        <div className="lbl">
          <button type="button" className="plain lbl" aria-expanded={srcOpen} onClick={() => setSrcOpen((o) => !o)}>
            Sources {srcOpen ? "▴" : "▾"} <span className="cnt">{enabledSources}/{SOURCES.length}</span>
          </button>
          <span className="btns">
            <button type="button" onClick={() => update({ disabledSources: [] })}>all</button>
            <button type="button" onClick={() => update({ disabledSources: SOURCES.map((s) => s.id) })}>none</button>
          </span>
        </div>
        {srcOpen && (
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
        )}
      </section>
    </>
  );

  return (
    <aside className="sidebar" aria-label="Filters">
      {narrow && (
        <button type="button" className="filtersbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>Filters {open ? "▴" : "▾"}</span>
          <span className="muted">{prefs.window} · {prefs.lanes.length}/{LANES.length} lanes · {enabledSources} sources</span>
        </button>
      )}
      {(!narrow || open) && body}
    </aside>
  );
}

const Sidebar = memo(SidebarBase);
export default Sidebar;
