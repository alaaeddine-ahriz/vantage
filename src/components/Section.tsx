"use client";

import type { ReactNode } from "react";

export interface SectionProps {
  id: string;
  title: ReactNode;
  /** Small mono count printed after the title. */
  count?: ReactNode;
  /** Controls kept at the right of the header, outside the toggle button. */
  actions?: ReactNode;
  /** One-line summary shown in place of the body while folded. */
  summary?: ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

/** A sidebar section whose header folds its body; the open state lives in the prefs so it survives reloads. */
export default function Section({ id, title, count, actions, summary, open, onToggle, children }: SectionProps) {
  const bodyId = `sec-${id}`;
  return (
    <section className={`sec${open ? "" : " closed"}`} data-panel={id}>
      <div className="lbl">
        <button type="button" className="plain lbl fold" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)}>
          <span className="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
          {title}
          {count !== undefined && <span className="cnt">{count}</span>}
        </button>
        {actions && <span className="btns">{actions}</span>}
      </div>
      {open ? <div id={bodyId}>{children}</div> : summary ? <div className="secsum muted">{summary}</div> : null}
    </section>
  );
}
