"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import type { Brief, IntelSnapshot, Pattern } from "@/lib/intel-types";
import type { LaneId } from "@/lib/types";
import { LANE_BY_ID, fold, relativeTime, utcClock, type ViewItem } from "./util";
import s from "./IntelPanel.module.css";

export type BriefState = "idle" | "loading" | "error";

export interface IntelPanelProps {
  snapshot: IntelSnapshot | null;
  brief: Brief | null;
  briefState: BriefState;
  briefError?: string;
  onGenerate: () => void;
  onSearch: (q: string) => void;
  items: Map<string, ViewItem>;
  watchlist: string[];
  onAddWatch: (t: string) => void;
  /** Window label shown next to the header, e.g. "24h". */
  window?: string;
  now?: number;
}

const KIND_CLASS: Record<Pattern["kind"], string> = {
  spike: s.k_spike,
  emerging: s.k_emerging,
  cluster: s.k_cluster,
  "co-movement": s.k_comovement,
  ai: s.k_ai,
};

// ------------------------------------------------------------------ tiny markdown

/** Inline pass: only **bold** is recognised; everything else is plain text nodes. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<b key={`${key}-${n++}`}>{m[1]}</b>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block pass: bullet runs become lists, other lines become paragraphs. No HTML is ever parsed. */
export function renderMarkdown(md: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let k = 0;
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${k++}`}>
        {bullets.map((b, i) => <li key={i}>{inline(b, `b${k}-${i}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const bm = /^[-*•]\s+(.*)$/.exec(line);
    if (bm) { bullets.push(bm[1]); continue; }
    flush();
    blocks.push(<p key={`p-${k++}`}>{inline(line.replace(/^#+\s*/, ""), `p${k}`)}</p>);
  }
  flush();
  return blocks;
}

// ------------------------------------------------------------------ pieces

function Cites({ ids, items, max = 6 }: { ids: string[]; items: Map<string, ViewItem>; max?: number }) {
  const rows = ids.map((id) => items.get(id)).filter((x): x is ViewItem => !!x).slice(0, max);
  if (!rows.length) return null;
  return (
    <ul className={s.cites}>
      {rows.map((it) => (
        <li key={it.id}>
          <span className={`dot lc-${it.lane}`} aria-hidden="true" />
          <span>
            <a href={it.link} target="_blank" rel="noopener noreferrer">{it.title}</a>{" "}
            <span className={s.src}>{it.source}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PatternCard({ p, snapshot, items, onSearch }: { p: Pattern; snapshot: IntelSnapshot; items: Map<string, ViewItem>; onSearch: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  const ents = p.entityIds.map((id) => snapshot.entities[id]).filter(Boolean).slice(0, 6);
  const related = p.itemIds.map((id) => items.get(id)).filter((x): x is ViewItem => !!x).slice(0, 3);
  const pct = Math.round(Math.min(1, Math.max(0, p.score)) * 100);
  return (
    <article className={`${s.pat} ${KIND_CLASS[p.kind] ?? ""}`}>
      <div className={s.patrow}>
        <span className={s.kind}>{p.kind}</span>
        <span className={s.ptitle}>{p.title}</span>
        <span className={s.pscore} title="pattern score">{pct}</span>
      </div>
      {p.detail && <div className={s.pdetail}>{p.detail}</div>}
      <div className={s.bar} aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      {ents.length > 0 && (
        <div className={s.chips}>
          {ents.map((e) => (
            <button key={e.id} type="button" title={`Search ${e.label}`} onClick={() => onSearch(e.label)}>{e.label}</button>
          ))}
        </div>
      )}
      {related.length > 0 && (
        <>
          <button type="button" className={`plain ${s.toggle}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "hide" : "show"} {related.length} headline{related.length > 1 ? "s" : ""}
          </button>
          {open && (
            <ul className={s.related}>
              {related.map((it) => (
                <li key={it.id}>
                  <span className={`dot lc-${it.lane}`} aria-hidden="true" />
                  <span>
                    <a href={it.link} target="_blank" rel="noopener noreferrer">{it.title}</a>{" "}
                    <span className={s.src}>{it.source}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

function IntelPanelBase(p: IntelPanelProps) {
  const now = p.now ?? Date.now();
  const have = useMemo(() => new Set(p.watchlist.map(fold)), [p.watchlist]);
  const loading = p.briefState === "loading";
  const b = p.brief;
  const briefTs = b ? Date.parse(b.generatedAt) || 0 : 0;

  return (
    <div className={s.wrap} aria-label="Intelligence">
      <div className={s.head}>
        <span className="lbl">Intelligence</span>
        {p.window && <span className={s.note}>window {p.window}{p.snapshot ? ` · ${p.snapshot.patterns.length} local patterns · ${p.snapshot.points.length} countries` : ""}</span>}
        <span className={s.spacer} />
        {briefTs > 0 && (
          <span className={`${s.note} mono`} title={new Date(briefTs).toLocaleString()}>
            brief {utcClock(briefTs, false)} UTC ({relativeTime(briefTs, now)})
          </span>
        )}
        {b?.mock && <span className={s.note}>sample brief: set ANTHROPIC_API_KEY on Vercel for live analysis</span>}
        {p.briefState === "error" && p.briefError && <span className={s.error} role="alert">{p.briefError}</span>}
        <button type="button" className={`chip ${s.gen}`} onClick={p.onGenerate} disabled={loading || !p.snapshot} title="Send the current headlines to the model for an analyst brief">
          {loading && <span className={s.spinner} aria-hidden="true" />}
          {loading ? "generating" : "Generate AI brief"}
        </button>
      </div>

      <div className={s.cols}>
        <section className={s.col} aria-label="Local patterns">
          <header className={s.colhead}>
            <span className="lbl">Patterns (local)</span>
            <span className="cnt">{p.snapshot?.patterns.length ?? 0}</span>
          </header>
          <div className={s.scroll}>
            {!p.snapshot ? (
              <div className={s.empty}>loading</div>
            ) : !p.snapshot.patterns.length ? (
              <div className={s.empty}>no patterns in this window: widen the window or clear filters</div>
            ) : (
              p.snapshot.patterns.map((pt) => <PatternCard key={pt.id} p={pt} snapshot={p.snapshot!} items={p.items} onSearch={p.onSearch} />)
            )}
          </div>
        </section>

        <section className={s.col} aria-label="AI brief">
          <header className={s.colhead}>
            <span className="lbl">AI brief</span>
            {b && <span className="cnt">{b.model}</span>}
          </header>
          <div className={s.scroll}>
            {!b ? (
              <div className={s.empty}>
                <p>
                  The brief sends the headlines currently shown (window, search and filters applied, newest 250) to the model and
                  returns a headline, a recap, per-lane summaries with cited items, patterns with confidence, entity links that are
                  merged into the graph, and watch terms you can add in one click.
                </p>
                {p.briefState === "error" && p.briefError && <p className={s.error}>{p.briefError}</p>}
                <button type="button" className={`chip ${s.gen}`} onClick={p.onGenerate} disabled={loading || !p.snapshot}>
                  {loading && <span className={s.spinner} aria-hidden="true" />}
                  {loading ? "generating" : "Generate AI brief"}
                </button>
              </div>
            ) : (
              <div className={s.brief}>
                <div>
                  <div className={s.headline}>{b.headline}</div>
                  <div className={s.meta}>
                    {b.lanes.length} lanes · {b.patterns.length} patterns · {b.links.length} links
                    {b.error ? ` · ${b.error}` : ""}
                  </div>
                </div>
                <div className={s.md}>{renderMarkdown(b.recap)}</div>

                {b.lanes.length > 0 && (
                  <div className={s.sec}>
                    <div className="lbl">Lanes</div>
                    {b.lanes.map((l) => (
                      <div key={l.lane} className={`${s.lane} lc-${l.lane}`}>
                        <div className={s.lanehead}>
                          <span className="dot" aria-hidden="true" />
                          <span className={s.name}>{LANE_BY_ID[l.lane as LaneId]?.label ?? l.lane}</span>
                          <span className="cnt">{l.itemIds.length}</span>
                        </div>
                        <div className={s.summary}>{inline(l.summary, `l-${l.lane}`)}</div>
                        <Cites ids={l.itemIds} items={p.items} />
                      </div>
                    ))}
                  </div>
                )}

                {b.patterns.length > 0 && (
                  <div className={s.sec}>
                    <div className="lbl">Patterns</div>
                    {b.patterns.map((pt, i) => {
                      const pct = Math.round(pt.confidence * 100);
                      return (
                        <div key={i} className={`${s.bp} ${s.k_ai}`}>
                          <div className={s.bprow}>
                            <span className={s.t}>{pt.title}</span>
                            <span className={s.conf} title="model confidence">{pct}%</span>
                          </div>
                          {pt.detail && <div className={s.pdetail}>{pt.detail}</div>}
                          <div className={s.bar} aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                          <Cites ids={pt.itemIds} items={p.items} max={3} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {b.links.length > 0 && (
                  <div className={s.sec}>
                    <div className="lbl">Links</div>
                    <div className={s.links}>
                      {b.links.map((l, i) => (
                        <div key={i} className={s.link}>
                          <button type="button" className={`plain ${s.ent}`} onClick={() => p.onSearch(l.source)} title="Search this entity">{l.source}</button>
                          <span className={s.kind}>{l.kind}</span>
                          <button type="button" className={`plain ${s.ent}`} onClick={() => p.onSearch(l.target)} title="Search this entity">{l.target}</button>
                          <span className={s.label}>{l.label}</span>
                          {l.itemIds.length > 0 && <span className={s.ids}>{l.itemIds.slice(0, 4).join(" ")}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {b.watch.length > 0 && (
                  <div className={s.sec}>
                    <div className="lbl">Suggested watch terms</div>
                    <div className={s.watch}>
                      {b.watch.map((w) => {
                        const on = have.has(fold(w));
                        return (
                          <span key={w} className={`${s.chip}${on ? ` ${s.have}` : ""}`}>
                            {w}
                            {on ? (
                              <span className="cnt" title="already on the watchlist">{"✓"}</span>
                            ) : (
                              <button type="button" aria-label={`Add ${w} to watchlist`} title="Add to watchlist" onClick={() => p.onAddWatch(w)}>+</button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const IntelPanel = memo(IntelPanelBase);
export default IntelPanel;
